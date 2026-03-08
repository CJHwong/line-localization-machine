/**
 * @license
 * Copyright Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
import { jsonTokenTypeToString, tokenize, } from './tokenize.js';
/**
 * Incrementally parses a single JSON value from the given iterable of string
 * chunks.
 *
 * Yields a sequence of increasingly complete JSON values as more of the input
 * can be parsed. The final value yielded will be the same as running JSON.parse
 * on the entire input as a single string. If the input is not valid JSON,
 * throws an error in the same way that JSON.parse would, though the error
 * message is not guaranteed to be the same.
 *
 * When possible (i.e. with objects and arrays), the yielded JSON values will
 * be reused. This means that if you store a reference to a yielded value, it
 * will be updated in place as more of the input is parsed.
 *
 * As with JSON.parse, this throws if non-whitespace trailing content is found.
 *
 * For performance, it parses as much of the string that's synchronously
 * available before yielding. So the sequence of partially-complete values
 * that you'll see will vary based on how the input is grouped into stream
 * chunks.
 *
 * The following invariants will also be maintained:
 *
 * 1.  Subsequent versions of a value will have the same type. i.e. we will
 *     never yield a value as a string and then later replace it with an array
 *     (unless the object has repeated keys, see invariant 7).
 * 2.  true, false, null, and numbers are atomic, we don't yield them until
 *     we have the entire value.
 * 3.  Strings may be replaced with a longer string, with more characters (in
 *     the JavaScript sense) appended.
 * 4.  Arrays are modified only by appending new elements or
 *     replacing/mutating the element currently at the end.
 * 5.  Objects are only modified by either adding new properties, or
 *     replacing/mutating the most recently added property, (except in the case
 *     of repeated keys, see invariant 7).
 * 6.  As a consequence of 1 and 5, we only add a property to an object once we
 *     have the entire key and enough of the value to know that value's type.
 * 7.  If an object has the same key multiple times, later values take
 *     precedence over earlier ones, matching the behavior of JSON.parse. This
 *     may result in changing the type of a value, and setting earlier keys
 *     the object.
 */
export async function* parse(stream, options) {
    yield* new Parser(stream, options?.completeCallback);
}
function setObjectProperty(object, key, value) {
    if (key === '__proto__') {
        Object.defineProperty(object, key, {
            value,
            writable: true,
            enumerable: true,
            configurable: true,
        });
    }
    else {
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
                case 1 /* StateEnum.InString */:
                case 0 /* StateEnum.Initial */:
                    throw new Error(`path.segments() was called with unexpected parser state. Called asynchronously?`);
                case 3 /* StateEnum.InObjectExpectingKey */:
                    if (state.value[0] !== undefined) {
                        result.push(state.value[0]);
                    }
                    continue;
                case 2 /* StateEnum.InArray */:
                    result.push(state.value.length - 1);
                    continue;
                case 4 /* StateEnum.InObjectExpectingValue */:
                    result.push(state.value[0]);
                    continue;
                default: {
                    const never = state;
                    throw new Error(`Unexpected state: ${String(never)}`);
                }
            }
        }
        return result;
    }
}
class Parser {
    stateStack = [
        { type: 0 /* StateEnum.Initial */, value: undefined },
    ];
    toplevelValue;
    tokenizer;
    finished = false;
    progressed = false;
    completeCallback;
    completeValueInfo;
    constructor(textStream, completeCallback) {
        this.completeCallback = completeCallback;
        this.completeValueInfo = new CompleteValueInfo(this.stateStack);
        this.tokenizer = tokenize(textStream, this);
    }
    async next() {
        if (this.finished) {
            return { done: true, value: undefined };
        }
        while (true) {
            this.progressed = false;
            await this.tokenizer.pump();
            if (this.toplevelValue === undefined) {
                throw new Error('Internal error: toplevelValue should not be undefined after at least one call to pump()');
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
        this.handleValueToken(0 /* JsonTokenType.Null */, undefined);
    }
    handleBoolean(value) {
        this.handleValueToken(1 /* JsonTokenType.Boolean */, value);
    }
    handleNumber(value) {
        this.handleValueToken(2 /* JsonTokenType.Number */, value);
    }
    handleStringStart() {
        const state = this.currentState();
        if (!this.progressed && state.type !== 3 /* StateEnum.InObjectExpectingKey */) {
            this.progressed = true;
        }
        switch (state.type) {
            case 0 /* StateEnum.Initial */:
                this.stateStack.pop();
                this.toplevelValue = this.progressValue(3 /* JsonTokenType.StringStart */, undefined);
                break;
            case 2 /* StateEnum.InArray */: {
                const v = this.progressValue(3 /* JsonTokenType.StringStart */, undefined);
                state.value.push(v);
                break;
            }
            case 3 /* StateEnum.InObjectExpectingKey */:
                this.stateStack.push({ type: 1 /* StateEnum.InString */, value: '' });
                break;
            case 4 /* StateEnum.InObjectExpectingValue */: {
                const [key, object] = state.value;
                const sv = this.progressValue(3 /* JsonTokenType.StringStart */, undefined);
                setObjectProperty(object, key, sv);
                break;
            }
            case 1 /* StateEnum.InString */:
                throw new Error(`Unexpected ${jsonTokenTypeToString(3 /* JsonTokenType.StringStart */)} token in the middle of string starting ${JSON.stringify(state.value)}`);
        }
    }
    handleStringMiddle(value) {
        const state = this.currentState();
        if (!this.progressed) {
            const prev = this.stateStack[this.stateStack.length - 2];
            if (prev?.type !== 3 /* StateEnum.InObjectExpectingKey */) {
                this.progressed = true;
            }
        }
        if (state.type !== 1 /* StateEnum.InString */) {
            throw new Error(`Unexpected ${jsonTokenTypeToString(4 /* JsonTokenType.StringMiddle */)} token in the middle of string starting ${JSON.stringify(state.value)}`);
        }
        state.value += value;
        const parentState = this.stateStack[this.stateStack.length - 2];
        this.updateStringParent(state.value, parentState, false);
    }
    handleStringEnd() {
        const state = this.currentState();
        if (state.type !== 1 /* StateEnum.InString */) {
            throw new Error(`Unexpected ${jsonTokenTypeToString(5 /* JsonTokenType.StringEnd */)} token in the middle of string starting ${JSON.stringify(state.value)}`);
        }
        this.stateStack.pop();
        const parentState = this.stateStack[this.stateStack.length - 1];
        this.updateStringParent(state.value, parentState, true);
    }
    handleArrayStart() {
        this.handleValueToken(6 /* JsonTokenType.ArrayStart */, undefined);
    }
    handleArrayEnd() {
        const state = this.currentState();
        if (state.type !== 2 /* StateEnum.InArray */) {
            throw new Error(`Unexpected ${jsonTokenTypeToString(7 /* JsonTokenType.ArrayEnd */)} token`);
        }
        this.stateStack.pop();
        if (this.completeCallback !== undefined) {
            this.completeCallback(state.value, this.completeValueInfo);
        }
    }
    handleObjectStart() {
        this.handleValueToken(8 /* JsonTokenType.ObjectStart */, undefined);
    }
    handleObjectEnd() {
        const state = this.currentState();
        switch (state.type) {
            case 3 /* StateEnum.InObjectExpectingKey */:
            case 4 /* StateEnum.InObjectExpectingValue */:
                this.stateStack.pop();
                if (this.completeCallback !== undefined) {
                    this.completeCallback(state.value[1], this.completeValueInfo);
                }
                break;
            default:
                throw new Error(`Unexpected ${jsonTokenTypeToString(9 /* JsonTokenType.ObjectEnd */)} token`);
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
            case 0 /* StateEnum.Initial */:
                this.stateStack.pop();
                this.toplevelValue = this.progressValue(type, value);
                if (this.completeCallback !== undefined &&
                    this.stateStack.length === 0) {
                    this.completeCallback(this.toplevelValue, this.completeValueInfo);
                }
                break;
            case 2 /* StateEnum.InArray */: {
                const v = this.progressValue(type, value);
                state.value.push(v);
                if (this.completeCallback !== undefined &&
                    this.stateStack[this.stateStack.length - 1] === state) {
                    this.completeCallback(v, this.completeValueInfo);
                }
                break;
            }
            case 4 /* StateEnum.InObjectExpectingValue */: {
                const [key, object] = state.value;
                let expectedState = state;
                if (type !== 3 /* JsonTokenType.StringStart */) {
                    this.stateStack.pop();
                    expectedState = {
                        type: 3 /* StateEnum.InObjectExpectingKey */,
                        value: [key, object],
                    };
                    this.stateStack.push(expectedState);
                }
                const v = this.progressValue(type, value);
                setObjectProperty(object, key, v);
                if (this.completeCallback !== undefined &&
                    this.stateStack[this.stateStack.length - 1] === expectedState) {
                    this.completeCallback(v, this.completeValueInfo);
                }
                break;
            }
            case 1 /* StateEnum.InString */:
                throw new Error(`Unexpected ${jsonTokenTypeToString(type)} token in the middle of string starting ${JSON.stringify(state.value)}`);
            case 3 /* StateEnum.InObjectExpectingKey */:
                throw new Error(`Unexpected ${jsonTokenTypeToString(type)} token in the middle of object expecting key`);
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
            case 2 /* StateEnum.InArray */:
                parentState.value[parentState.value.length - 1] = updated;
                if (isFinal && this.completeCallback !== undefined) {
                    this.completeCallback(updated, this.completeValueInfo);
                }
                break;
            case 4 /* StateEnum.InObjectExpectingValue */: {
                const [key, object] = parentState.value;
                setObjectProperty(object, key, updated);
                if (isFinal && this.completeCallback !== undefined) {
                    this.completeCallback(updated, this.completeValueInfo);
                }
                if (this.stateStack[this.stateStack.length - 1] === parentState) {
                    this.stateStack.pop();
                    this.stateStack.push({
                        type: 3 /* StateEnum.InObjectExpectingKey */,
                        value: [key, object],
                    });
                }
                break;
            }
            case 3 /* StateEnum.InObjectExpectingKey */:
                if (this.stateStack[this.stateStack.length - 1] === parentState) {
                    this.stateStack.pop();
                    this.stateStack.push({
                        type: 4 /* StateEnum.InObjectExpectingValue */,
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
            case 0 /* JsonTokenType.Null */:
                return null;
            case 1 /* JsonTokenType.Boolean */:
                return value;
            case 2 /* JsonTokenType.Number */:
                return value;
            case 3 /* JsonTokenType.StringStart */: {
                const state = { type: 1 /* StateEnum.InString */, value: '' };
                this.stateStack.push(state);
                return '';
            }
            case 6 /* JsonTokenType.ArrayStart */: {
                const state = { type: 2 /* StateEnum.InArray */, value: [] };
                this.stateStack.push(state);
                return state.value;
            }
            case 8 /* JsonTokenType.ObjectStart */: {
                const state = {
                    type: 3 /* StateEnum.InObjectExpectingKey */,
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
//# sourceMappingURL=parse.js.map