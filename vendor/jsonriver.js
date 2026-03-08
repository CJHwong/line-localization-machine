/**
 * jsonriver - Streaming JSON parser
 *
 * @license BSD-3-Clause
 * Copyright Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Vendored from jsonriver@1.1.1
 * https://github.com/nicolo-ribaudo/jsonriver
 *
 * Bundled into a single ES module for browser extension use.
 */

// ─── Tokenizer ────────────────────────────────────────────────────────────────

const jsonNumberPattern = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

function parseJsonNumber(str) {
  if (!jsonNumberPattern.test(str)) {
    throw new Error('Invalid number');
  }
  return Number(str);
}

function jsonTokenTypeToString(type) {
  switch (type) {
    case 0:
      return 'null';
    case 1:
      return 'boolean';
    case 2:
      return 'number';
    case 3:
      return 'string start';
    case 4:
      return 'string middle';
    case 5:
      return 'string end';
    case 6:
      return 'array start';
    case 7:
      return 'array end';
    case 8:
      return 'object start';
    case 9:
      return 'object end';
  }
}

class Input {
  buffer = '';
  startIndex = 0;
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
      } else {
        break;
      }
    }
    this.startIndex = i;
  }

  tryToTakePrefix(prefix) {
    if (this.buffer.startsWith(prefix, this.startIndex)) {
      this.startIndex += prefix.length;
      return true;
    }
    return false;
  }

  tryToTake(len) {
    if (this.length < len) {
      return undefined;
    }
    const result = this.buffer.slice(this.startIndex, this.startIndex + len);
    this.startIndex += len;
    return result;
  }

  tryToTakeCharCode() {
    if (this.length === 0) {
      return undefined;
    }
    const code = this.buffer.charCodeAt(this.startIndex);
    this.startIndex++;
    return code;
  }

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

class Tokenizer {
  input;
  handler;
  stack = [0 /* ExpectingValue */];
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
        continue;
      }
      if (this.emittedTokens > start) {
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
        continue;
      }
    }
  }

  tokenizeMore() {
    const state = this.stack[this.stack.length - 1];
    switch (state) {
      case 0:
        this.tokenizeValue();
        break;
      case 1:
        this.tokenizeString();
        break;
      case 2:
        this.tokenizeArrayStart();
        break;
      case 3:
        this.tokenizeAfterArrayValue();
        break;
      case 4:
        this.tokenizeObjectStart();
        break;
      case 5:
        this.tokenizeAfterObjectKey();
        break;
      case 6:
        this.tokenizeAfterObjectValue();
        break;
      case 7:
        this.tokenizeBeforeObjectKey();
        break;
      case undefined:
        return;
      default:
        throw new Error(`Unreachable: ${JSON.stringify(state)}`);
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
        let i = 0;
        while (i < this.input.length) {
          const c = this.input.peekCharCode(i);
          if (
            (c >= 48 && c <= 57) ||
            c === 45 ||
            c === 43 ||
            c === 46 ||
            c === 101 ||
            c === 69
          ) {
            i++;
          } else {
            break;
          }
        }
        if (i === this.input.length && !this.input.bufferComplete) {
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
      this.stack.push(1);
      this.handler.handleStringStart();
      this.emittedTokens++;
      this.tokenizeString();
      return;
    }
    if (this.input.tryToTakePrefix('[')) {
      this.stack.pop();
      this.stack.push(2);
      this.handler.handleArrayStart();
      this.emittedTokens++;
      return this.tokenizeArrayStart();
    }
    if (this.input.tryToTakePrefix('{')) {
      this.stack.pop();
      this.stack.push(4);
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
      } else if (!interrupted) {
        return;
      }
      if (interrupted) {
        if (this.input.length === 0) {
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
        const nextChar2 = this.input.peek(1);
        if (nextChar2 === undefined) {
          return;
        }
        let value;
        switch (nextChar2) {
          case 'u': {
            if (this.input.length < 6) {
              return;
            }
            let code = 0;
            for (let j = 2; j < 6; j++) {
              const c = this.input.peekCharCode(j);
              const digit =
                c >= 48 && c <= 57
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
    } else {
      this.stack.pop();
      this.stack.push(3);
      this.stack.push(0);
      this.tokenizeValue();
    }
  }

  tokenizeAfterArrayValue() {
    this.input.skipPastWhitespace();
    const nextChar = this.input.tryToTakeCharCode();
    switch (nextChar) {
      case undefined:
        return;
      case 0x5d:
        this.handler.handleArrayEnd();
        this.emittedTokens++;
        this.stack.pop();
        return;
      case 0x2c:
        this.stack.push(0);
        return this.tokenizeValue();
      default:
        throw new Error(
          'Expected , or ], got ' + JSON.stringify(String.fromCharCode(nextChar))
        );
    }
  }

  tokenizeObjectStart() {
    this.input.skipPastWhitespace();
    const nextChar = this.input.tryToTakeCharCode();
    switch (nextChar) {
      case undefined:
        return;
      case 0x7d:
        this.handler.handleObjectEnd();
        this.emittedTokens++;
        this.stack.pop();
        return;
      case 0x22:
        this.stack.pop();
        this.stack.push(5);
        this.stack.push(1);
        this.handler.handleStringStart();
        this.emittedTokens++;
        return this.tokenizeString();
      default:
        throw new Error(
          'Expected start of object key, got ' + JSON.stringify(String.fromCharCode(nextChar))
        );
    }
  }

  tokenizeAfterObjectKey() {
    this.input.skipPastWhitespace();
    const nextChar = this.input.tryToTakeCharCode();
    switch (nextChar) {
      case undefined:
        return;
      case 0x3a:
        this.stack.pop();
        this.stack.push(6);
        this.stack.push(0);
        return this.tokenizeValue();
      default:
        throw new Error(
          'Expected colon after object key, got ' + JSON.stringify(String.fromCharCode(nextChar))
        );
    }
  }

  tokenizeAfterObjectValue() {
    this.input.skipPastWhitespace();
    const nextChar = this.input.tryToTakeCharCode();
    switch (nextChar) {
      case undefined:
        return;
      case 0x7d:
        this.handler.handleObjectEnd();
        this.emittedTokens++;
        this.stack.pop();
        return;
      case 0x2c:
        this.stack.pop();
        this.stack.push(7);
        return this.tokenizeBeforeObjectKey();
      default:
        throw new Error(
          'Expected , or } after object value, got ' +
            JSON.stringify(String.fromCharCode(nextChar))
        );
    }
  }

  tokenizeBeforeObjectKey() {
    this.input.skipPastWhitespace();
    const nextChar = this.input.tryToTakeCharCode();
    switch (nextChar) {
      case undefined:
        return;
      case 0x22:
        this.stack.pop();
        this.stack.push(5);
        this.stack.push(1);
        this.handler.handleStringStart();
        this.emittedTokens++;
        return this.tokenizeString();
      default:
        throw new Error(
          'Expected start of object key, got ' + JSON.stringify(String.fromCharCode(nextChar))
        );
    }
  }
}

// ─── Parser ───────────────────────────────────────────────────────────────────

function setObjectProperty(object, key, value) {
  if (key === '__proto__') {
    Object.defineProperty(object, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  } else {
    object[key] = value;
  }
}

const privateStateStackSymbol = Symbol('stateStack');

class CompleteValueInfo {
  [privateStateStackSymbol];

  constructor(actualStateStack) {
    this[privateStateStackSymbol] = actualStateStack;
  }

  segments() {
    const result = [];
    for (let i = 0; i < this[privateStateStackSymbol].length; i++) {
      const state = this[privateStateStackSymbol][i];
      switch (state.type) {
        case 1:
        case 0:
          throw new Error(
            `path.segments() was called with unexpected parser state. Called asynchronously?`
          );
        case 3:
          if (state.value[0] !== undefined) {
            result.push(state.value[0]);
          }
          continue;
        case 2:
          result.push(state.value.length - 1);
          continue;
        case 4:
          result.push(state.value[0]);
          continue;
        default:
          throw new Error(`Unexpected state: ${String(state)}`);
      }
    }
    return result;
  }
}

class Parser {
  stateStack = [{ type: 0, value: undefined }];
  toplevelValue;
  tokenizer;
  finished = false;
  progressed = false;
  completeCallback;
  completeValueInfo;

  constructor(textStream, completeCallback) {
    this.completeCallback = completeCallback;
    this.completeValueInfo = new CompleteValueInfo(this.stateStack);
    this.tokenizer = new Tokenizer(textStream, this);
  }

  async next() {
    if (this.finished) {
      return { done: true, value: undefined };
    }
    while (true) {
      this.progressed = false;
      await this.tokenizer.pump();
      if (this.toplevelValue === undefined) {
        throw new Error(
          'Internal error: toplevelValue should not be undefined after at least one call to pump()'
        );
      }
      if (this.progressed) {
        return { done: false, value: this.toplevelValue };
      }
      if (this.stateStack.length === 0) {
        await this.tokenizer.pump();
        this.finished = true;
        return { done: true, value: undefined };
      }
    }
  }

  [Symbol.asyncIterator]() {
    return this;
  }

  handleNull() {
    this.handleValueToken(0, undefined);
  }

  handleBoolean(value) {
    this.handleValueToken(1, value);
  }

  handleNumber(value) {
    this.handleValueToken(2, value);
  }

  handleStringStart() {
    const state = this.currentState();
    if (!this.progressed && state.type !== 3) {
      this.progressed = true;
    }
    switch (state.type) {
      case 0:
        this.stateStack.pop();
        this.toplevelValue = this.progressValue(3, undefined);
        break;
      case 2: {
        const v = this.progressValue(3, undefined);
        state.value.push(v);
        break;
      }
      case 3:
        this.stateStack.push({ type: 1, value: '' });
        break;
      case 4: {
        const [key, object] = state.value;
        const sv = this.progressValue(3, undefined);
        setObjectProperty(object, key, sv);
        break;
      }
      case 1:
        throw new Error(
          `Unexpected ${jsonTokenTypeToString(3)} token in the middle of string starting ${JSON.stringify(state.value)}`
        );
    }
  }

  handleStringMiddle(value) {
    const state = this.currentState();
    if (!this.progressed) {
      const prev = this.stateStack[this.stateStack.length - 2];
      if (prev?.type !== 3) {
        this.progressed = true;
      }
    }
    if (state.type !== 1) {
      throw new Error(
        `Unexpected ${jsonTokenTypeToString(4)} token in the middle of string starting ${JSON.stringify(state.value)}`
      );
    }
    state.value += value;
    const parentState = this.stateStack[this.stateStack.length - 2];
    this.updateStringParent(state.value, parentState, false);
  }

  handleStringEnd() {
    const state = this.currentState();
    if (state.type !== 1) {
      throw new Error(
        `Unexpected ${jsonTokenTypeToString(5)} token in the middle of string starting ${JSON.stringify(state.value)}`
      );
    }
    this.stateStack.pop();
    const parentState = this.stateStack[this.stateStack.length - 1];
    this.updateStringParent(state.value, parentState, true);
  }

  handleArrayStart() {
    this.handleValueToken(6, undefined);
  }

  handleArrayEnd() {
    const state = this.currentState();
    if (state.type !== 2) {
      throw new Error(`Unexpected ${jsonTokenTypeToString(7)} token`);
    }
    this.stateStack.pop();
    if (this.completeCallback !== undefined) {
      this.completeCallback(state.value, this.completeValueInfo);
    }
  }

  handleObjectStart() {
    this.handleValueToken(8, undefined);
  }

  handleObjectEnd() {
    const state = this.currentState();
    switch (state.type) {
      case 3:
      case 4:
        this.stateStack.pop();
        if (this.completeCallback !== undefined) {
          this.completeCallback(state.value[1], this.completeValueInfo);
        }
        break;
      default:
        throw new Error(`Unexpected ${jsonTokenTypeToString(9)} token`);
    }
  }

  currentState() {
    const state = this.stateStack[this.stateStack.length - 1];
    if (state === undefined) {
      throw new Error('Unexpected trailing input');
    }
    return state;
  }

  handleValueToken(type, value) {
    const state = this.currentState();
    if (!this.progressed) {
      this.progressed = true;
    }
    switch (state.type) {
      case 0:
        this.stateStack.pop();
        this.toplevelValue = this.progressValue(type, value);
        if (this.completeCallback !== undefined && this.stateStack.length === 0) {
          this.completeCallback(this.toplevelValue, this.completeValueInfo);
        }
        break;
      case 2: {
        const v = this.progressValue(type, value);
        state.value.push(v);
        if (
          this.completeCallback !== undefined &&
          this.stateStack[this.stateStack.length - 1] === state
        ) {
          this.completeCallback(v, this.completeValueInfo);
        }
        break;
      }
      case 4: {
        const [key, object] = state.value;
        let expectedState = state;
        if (type !== 3) {
          this.stateStack.pop();
          expectedState = {
            type: 3,
            value: [key, object],
          };
          this.stateStack.push(expectedState);
        }
        const v = this.progressValue(type, value);
        setObjectProperty(object, key, v);
        if (
          this.completeCallback !== undefined &&
          this.stateStack[this.stateStack.length - 1] === expectedState
        ) {
          this.completeCallback(v, this.completeValueInfo);
        }
        break;
      }
      case 1:
        throw new Error(
          `Unexpected ${jsonTokenTypeToString(type)} token in the middle of string starting ${JSON.stringify(state.value)}`
        );
      case 3:
        throw new Error(
          `Unexpected ${jsonTokenTypeToString(type)} token in the middle of object expecting key`
        );
    }
  }

  updateStringParent(updated, parentState, isFinal) {
    switch (parentState?.type) {
      case undefined:
        this.toplevelValue = updated;
        if (isFinal && this.completeCallback !== undefined) {
          this.completeCallback(updated, this.completeValueInfo);
        }
        break;
      case 2:
        parentState.value[parentState.value.length - 1] = updated;
        if (isFinal && this.completeCallback !== undefined) {
          this.completeCallback(updated, this.completeValueInfo);
        }
        break;
      case 4: {
        const [key, object] = parentState.value;
        setObjectProperty(object, key, updated);
        if (isFinal && this.completeCallback !== undefined) {
          this.completeCallback(updated, this.completeValueInfo);
        }
        if (this.stateStack[this.stateStack.length - 1] === parentState) {
          this.stateStack.pop();
          this.stateStack.push({
            type: 3,
            value: [key, object],
          });
        }
        break;
      }
      case 3:
        if (this.stateStack[this.stateStack.length - 1] === parentState) {
          this.stateStack.pop();
          this.stateStack.push({
            type: 4,
            value: [updated, parentState.value[1]],
          });
        }
        break;
      default:
        throw new Error('Unexpected parent state for string: ' + parentState?.type);
    }
  }

  progressValue(type, value) {
    switch (type) {
      case 0:
        return null;
      case 1:
        return value;
      case 2:
        return value;
      case 3: {
        const state = { type: 1, value: '' };
        this.stateStack.push(state);
        return '';
      }
      case 6: {
        const state = { type: 2, value: [] };
        this.stateStack.push(state);
        return state.value;
      }
      case 8: {
        const state = {
          type: 3,
          value: [undefined, {}],
        };
        this.stateStack.push(state);
        return state.value[1];
      }
      default:
        throw new Error('Unexpected token type: ' + jsonTokenTypeToString(type));
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Incrementally parses a single JSON value from the given async iterable
 * of string chunks.
 *
 * @param {AsyncIterable<string>} stream - Async iterable of string chunks
 * @param {Object} [options] - Options
 * @param {Function} [options.completeCallback] - Called when a value completes.
 *   Receives (value, pathInfo) where pathInfo.segments() returns the JSON path.
 * @yields {*} Progressively complete JSON values
 */
export async function* parse(stream, options) {
  yield* new Parser(stream, options?.completeCallback);
}
