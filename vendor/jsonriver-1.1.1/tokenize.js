/**
 * @license
 * Copyright Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
/**
 * Read tokens from an async iterable of strings and forward them to the given
 * {@link TokenHandler}. The handler is invoked synchronously as tokens are
 * recognized. Throws if the input is not valid JSON, including if it has
 * trailing content.
 */
export function tokenize(stream, handler) {
    return new Tokenizer(stream, handler);
}
const jsonNumberPattern = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
function parseJsonNumber(str) {
    if (!jsonNumberPattern.test(str)) {
        throw new Error('Invalid number');
    }
    return Number(str);
}
export class Tokenizer {
    input;
    handler;
    stack = [0 /* State.ExpectingValue */];
    emittedTokens = 0;
    constructor(stream, handler) {
        this.input = new Input(stream);
        this.handler = handler;
    }
    isDone() {
        return this.stack.length === 0 && this.input.length === 0;
    }
    async pump() {
        const start = this.emittedTokens;
        while (true) {
            const before = this.emittedTokens;
            this.tokenizeMore();
            if (this.emittedTokens > before) {
                // Keep processing buffered tokens until we've exhausted them so that
                // tokenization and parsing happen in larger batches.
                continue;
            }
            if (this.emittedTokens > start) {
                // We emitted at least one token and can't make more progress without
                // additional input.
                this.input.commit();
                return;
            }
            if (this.stack.length === 0) {
                await this.input.expectEndOfContent();
                this.input.commit();
                return;
            }
            const expanded = await this.input.tryToExpandBuffer();
            if (!expanded) {
                // No more input. Loop again so that any buffered tokens are processed
                // before we enforce the end-of-content check.
                continue;
            }
        }
    }
    tokenizeMore() {
        const state = this.stack[this.stack.length - 1];
        switch (state) {
            case 0 /* State.ExpectingValue */:
                this.tokenizeValue();
                break;
            case 1 /* State.InString */:
                this.tokenizeString();
                break;
            case 2 /* State.StartArray */:
                this.tokenizeArrayStart();
                break;
            case 3 /* State.AfterArrayValue */:
                this.tokenizeAfterArrayValue();
                break;
            case 4 /* State.StartObject */:
                this.tokenizeObjectStart();
                break;
            case 5 /* State.AfterObjectKey */:
                this.tokenizeAfterObjectKey();
                break;
            case 6 /* State.AfterObjectValue */:
                this.tokenizeAfterObjectValue();
                break;
            case 7 /* State.BeforeObjectKey */:
                this.tokenizeBeforeObjectKey();
                break;
            case undefined:
                return;
            default: {
                const never = state;
                throw new Error(`Unreachable: ${JSON.stringify(never)}`);
            }
        }
    }
    tokenizeValue() {
        this.input.skipPastWhitespace();
        if (this.input.tryToTakePrefix('null')) {
            this.handler.handleNull();
            this.emittedTokens++;
            this.stack.pop();
            return;
        }
        if (this.input.tryToTakePrefix('true')) {
            this.handler.handleBoolean(true);
            this.emittedTokens++;
            this.stack.pop();
            return;
        }
        if (this.input.tryToTakePrefix('false')) {
            this.handler.handleBoolean(false);
            this.emittedTokens++;
            this.stack.pop();
            return;
        }
        if (this.input.length > 0) {
            const ch = this.input.peekCharCode(0);
            if ((ch >= 48 && ch <= 57) || ch === 45) {
                // Slightly tricky spot, because numbers don't have a terminator,
                // they might end on the end of input, or they might end because we hit
                // a non-number character.
                // Scan for the end of the number without allocating the entire
                // remaining buffer.
                let i = 0;
                while (i < this.input.length) {
                    const c = this.input.peekCharCode(i);
                    if ((c >= 48 && c <= 57) ||
                        c === 45 ||
                        c === 43 ||
                        c === 46 ||
                        c === 101 ||
                        c === 69) {
                        i++;
                    }
                    else {
                        break;
                    }
                }
                if (i === this.input.length && !this.input.bufferComplete) {
                    // Return to expand the buffer, but since there's no terminator for a
                    // number, we need to mark that finding the end of the input isn't a
                    // sign of failure.
                    this.input.moreContentExpected = false;
                    return;
                }
                const numberChars = this.input.slice(0, i);
                this.input.advance(i);
                const number = parseJsonNumber(numberChars);
                this.handler.handleNumber(number);
                this.emittedTokens++;
                this.stack.pop();
                this.input.moreContentExpected = true;
                return;
            }
        }
        if (this.input.tryToTakePrefix('"')) {
            this.stack.pop();
            this.stack.push(1 /* State.InString */);
            this.handler.handleStringStart();
            this.emittedTokens++;
            this.tokenizeString();
            return;
        }
        if (this.input.tryToTakePrefix('[')) {
            this.stack.pop();
            this.stack.push(2 /* State.StartArray */);
            this.handler.handleArrayStart();
            this.emittedTokens++;
            return this.tokenizeArrayStart();
        }
        if (this.input.tryToTakePrefix('{')) {
            this.stack.pop();
            this.stack.push(4 /* State.StartObject */);
            this.handler.handleObjectStart();
            this.emittedTokens++;
            return this.tokenizeObjectStart();
        }
    }
    tokenizeString() {
        while (true) {
            const [chunk, interrupted] = this.input.takeUntilQuoteOrBackslash();
            if (chunk.length > 0) {
                this.handler.handleStringMiddle(chunk);
                this.emittedTokens++;
            }
            else if (!interrupted) {
                // We've parsed everything we can in the buffer.
                return;
            }
            if (interrupted) {
                if (this.input.length === 0) {
                    // Can't continue without more input.
                    return;
                }
                const nextChar = this.input.peek(0);
                if (nextChar === '"') {
                    this.input.advance(1);
                    this.handler.handleStringEnd();
                    this.emittedTokens++;
                    this.stack.pop();
                    return;
                }
                // string escapes
                const nextChar2 = this.input.peek(1);
                if (nextChar2 === undefined) {
                    // Can't continue without more input.
                    return;
                }
                let value;
                switch (nextChar2) {
                    case 'u': {
                        // need 4 more characters
                        if (this.input.length < 6) {
                            return;
                        }
                        let code = 0;
                        for (let j = 2; j < 6; j++) {
                            const c = this.input.peekCharCode(j);
                            const digit = c >= 48 && c <= 57
                                ? c - 48
                                : c >= 65 && c <= 70
                                    ? c - 55
                                    : c >= 97 && c <= 102
                                        ? c - 87
                                        : -1;
                            if (digit === -1) {
                                throw new Error('Bad Unicode escape in JSON');
                            }
                            code = (code << 4) | digit;
                        }
                        this.input.advance(6);
                        this.handler.handleStringMiddle(String.fromCharCode(code));
                        this.emittedTokens++;
                        continue;
                    }
                    case 'n':
                        value = '\n';
                        break;
                    case 'r':
                        value = '\r';
                        break;
                    case 't':
                        value = '\t';
                        break;
                    case 'b':
                        value = '\b';
                        break;
                    case 'f':
                        value = '\f';
                        break;
                    case `\\`:
                        value = `\\`;
                        break;
                    case '/':
                        value = '/';
                        break;
                    case '"':
                        value = '"';
                        break;
                    default:
                        throw new Error('Bad escape in string');
                }
                this.input.advance(2);
                this.handler.handleStringMiddle(value);
                this.emittedTokens++;
            }
        }
    }
    tokenizeArrayStart() {
        this.input.skipPastWhitespace();
        if (this.input.length === 0) {
            return;
        }
        if (this.input.tryToTakePrefix(']')) {
            this.handler.handleArrayEnd();
            this.emittedTokens++;
            this.stack.pop();
            return;
        }
        else {
            this.stack.pop();
            this.stack.push(3 /* State.AfterArrayValue */);
            this.stack.push(0 /* State.ExpectingValue */);
            this.tokenizeValue();
        }
    }
    tokenizeAfterArrayValue() {
        this.input.skipPastWhitespace();
        const nextChar = this.input.tryToTakeCharCode();
        switch (nextChar) {
            case undefined: {
                return;
            }
            case 0x5d: {
                // ']'
                this.handler.handleArrayEnd();
                this.emittedTokens++;
                this.stack.pop();
                return;
            }
            case 0x2c: {
                // ','
                this.stack.push(0 /* State.ExpectingValue */);
                return this.tokenizeValue();
            }
            default: {
                throw new Error('Expected , or ], got ' +
                    JSON.stringify(String.fromCharCode(nextChar)));
            }
        }
    }
    tokenizeObjectStart() {
        this.input.skipPastWhitespace();
        const nextChar = this.input.tryToTakeCharCode();
        switch (nextChar) {
            case undefined: {
                return;
            }
            case 0x7d: {
                // '}'
                this.handler.handleObjectEnd();
                this.emittedTokens++;
                this.stack.pop();
                return;
            }
            case 0x22: {
                // '"'
                this.stack.pop();
                this.stack.push(5 /* State.AfterObjectKey */);
                this.stack.push(1 /* State.InString */);
                this.handler.handleStringStart();
                this.emittedTokens++;
                return this.tokenizeString();
            }
            default: {
                throw new Error('Expected start of object key, got ' +
                    JSON.stringify(String.fromCharCode(nextChar)));
            }
        }
    }
    tokenizeAfterObjectKey() {
        this.input.skipPastWhitespace();
        const nextChar = this.input.tryToTakeCharCode();
        switch (nextChar) {
            case undefined: {
                return;
            }
            case 0x3a: {
                // ':'
                this.stack.pop();
                this.stack.push(6 /* State.AfterObjectValue */);
                this.stack.push(0 /* State.ExpectingValue */);
                return this.tokenizeValue();
            }
            default: {
                throw new Error('Expected colon after object key, got ' +
                    JSON.stringify(String.fromCharCode(nextChar)));
            }
        }
    }
    tokenizeAfterObjectValue() {
        this.input.skipPastWhitespace();
        const nextChar = this.input.tryToTakeCharCode();
        switch (nextChar) {
            case undefined: {
                return;
            }
            case 0x7d: {
                // '}'
                this.handler.handleObjectEnd();
                this.emittedTokens++;
                this.stack.pop();
                return;
            }
            case 0x2c: {
                // ','
                this.stack.pop();
                this.stack.push(7 /* State.BeforeObjectKey */);
                return this.tokenizeBeforeObjectKey();
            }
            default: {
                throw new Error('Expected , or } after object value, got ' +
                    JSON.stringify(String.fromCharCode(nextChar)));
            }
        }
    }
    tokenizeBeforeObjectKey() {
        this.input.skipPastWhitespace();
        const nextChar = this.input.tryToTakeCharCode();
        switch (nextChar) {
            case undefined: {
                return;
            }
            case 0x22: {
                // '"'
                this.stack.pop();
                this.stack.push(5 /* State.AfterObjectKey */);
                this.stack.push(1 /* State.InString */);
                this.handler.handleStringStart();
                this.emittedTokens++;
                return this.tokenizeString();
            }
            default: {
                throw new Error('Expected start of object key, got ' +
                    JSON.stringify(String.fromCharCode(nextChar)));
            }
        }
    }
}
export function jsonTokenTypeToString(type) {
    switch (type) {
        case 0 /* JsonTokenType.Null */:
            return 'null';
        case 1 /* JsonTokenType.Boolean */:
            return 'boolean';
        case 2 /* JsonTokenType.Number */:
            return 'number';
        case 3 /* JsonTokenType.StringStart */:
            return 'string start';
        case 4 /* JsonTokenType.StringMiddle */:
            return 'string middle';
        case 5 /* JsonTokenType.StringEnd */:
            return 'string end';
        case 6 /* JsonTokenType.ArrayStart */:
            return 'array start';
        case 7 /* JsonTokenType.ArrayEnd */:
            return 'array end';
        case 8 /* JsonTokenType.ObjectStart */:
            return 'object start';
        case 9 /* JsonTokenType.ObjectEnd */:
            return 'object end';
    }
}
/**
 * Our input buffer.
 *
 * This was more feature rich when we interleaved awaits while tokenizing.
 * Now that we're doing all the work synchronously, it's a bit overkill.
 */
class Input {
    buffer = '';
    startIndex = 0;
    // True if no more content will be added to the buffer.
    bufferComplete = false;
    moreContentExpected = true;
    stream;
    constructor(stream) {
        this.stream = stream[Symbol.asyncIterator]();
    }
    get length() {
        return this.buffer.length - this.startIndex;
    }
    advance(len) {
        this.startIndex += len;
    }
    peek(offset) {
        return this.buffer[this.startIndex + offset];
    }
    peekCharCode(offset) {
        return this.buffer.charCodeAt(this.startIndex + offset);
    }
    slice(start, end) {
        return this.buffer.slice(this.startIndex + start, this.startIndex + end);
    }
    commit() {
        if (this.startIndex > 0) {
            this.buffer = this.buffer.slice(this.startIndex);
            this.startIndex = 0;
        }
    }
    remaining() {
        return this.buffer.slice(this.startIndex);
    }
    /**
     * Throws if there's any non-whitespace content left in the buffer or the
     * input stream.
     */
    async expectEndOfContent() {
        this.moreContentExpected = false;
        const check = () => {
            this.commit();
            this.skipPastWhitespace();
            if (this.length !== 0) {
                throw new Error(`Unexpected trailing content ${JSON.stringify(this.remaining())}`);
            }
        };
        check();
        while (await this.tryToExpandBuffer()) {
            check();
        }
        check();
    }
    /**
     * Tries to read more content into the buffer.
     *
     * Returns false if the stream is exhausted.
     */
    async tryToExpandBuffer() {
        if (this.bufferComplete) {
            if (this.moreContentExpected) {
                throw new Error('Unexpected end of content');
            }
            return false;
        }
        const result = await this.stream.next();
        if (result.done) {
            this.bufferComplete = true;
            if (this.moreContentExpected) {
                throw new Error('Unexpected end of content');
            }
            return false;
        }
        this.buffer += result.value;
        return true;
    }
    skipPastWhitespace() {
        let i = this.startIndex;
        while (i < this.buffer.length) {
            const c = this.buffer.charCodeAt(i);
            if (c === 32 || c === 9 || c === 10 || c === 13) {
                i++;
            }
            else {
                break;
            }
        }
        this.startIndex = i;
    }
    /**
     * If the buffer starts with `prefix`, consumes it and returns true.
     */
    tryToTakePrefix(prefix) {
        if (this.buffer.startsWith(prefix, this.startIndex)) {
            this.startIndex += prefix.length;
            return true;
        }
        return false;
    }
    /**
     * Tries to take `len` characters from the buffer.
     *
     * If there are fewer than `len` characters in the buffer, returns undefined.
     */
    tryToTake(len) {
        if (this.length < len) {
            return undefined;
        }
        const result = this.buffer.slice(this.startIndex, this.startIndex + len);
        this.startIndex += len;
        return result;
    }
    /**
     * Tries to take a single character from the buffer and returns its code.
     *
     * If there are no characters in the buffer, returns undefined.
     */
    tryToTakeCharCode() {
        if (this.length === 0) {
            return undefined;
        }
        const code = this.buffer.charCodeAt(this.startIndex);
        this.startIndex++;
        return code;
    }
    /**
     * Consumes and returns the input up to the first quote or backslash.
     *
     * If neither not found, consumes the entire buffer and returns it.
     *
     * Returns a tuple of the consumed content and a boolean indicating whether
     * the pattern was found.
     */
    takeUntilQuoteOrBackslash() {
        const buf = this.buffer;
        let i = this.startIndex;
        while (i < buf.length) {
            const c = buf.charCodeAt(i);
            if (c <= 0x1f) {
                throw new Error('Unescaped control character in string');
            }
            if (c === 34 || c === 92) {
                const result = buf.slice(this.startIndex, i);
                this.startIndex = i;
                return [result, true];
            }
            i++;
        }
        const result = buf.slice(this.startIndex);
        this.startIndex = buf.length;
        return [result, false];
    }
}
//# sourceMappingURL=tokenize.js.map