import IteratorTest, { expected, MAX_ITEMS } from './IteratorTest'
import { wait } from 'streamr-test-utils'

import { Pipeline, PushPipeline } from '../../src/utils/Pipeline'
import { PushBuffer, PullBuffer } from '../../src/utils/PushBuffer'
import { iteratorFinally } from '../../src/utils/iterators'

const WAIT = 20

async function* generate(items = expected, waitTime = WAIT) {
    await wait(waitTime * 0.1)
    for await (const item of items) {
        await wait(waitTime * 0.1)
        yield item
        await wait(waitTime * 0.1)
    }
    await wait(waitTime * 0.1)
}

describe('Pipeline', () => {

    it('types pipe & result correctly', async () => {
        // checking TS types.
        // The ts-expect-errors are the tests.
        const p1 = new Pipeline(generate())
            // @ts-expect-error incorrect type
            .pipe(async function* Step1(s: AsyncGenerator<string>) {
                yield* s
            })

        expect(p1).toBeTruthy() // avoid unused warning

        const p2 = new Pipeline(generate())
            .pipe(async function* Step1(s: AsyncGenerator<number>) {
                for await (const msg of s) {
                    yield String(msg) // change output type
                }
            })
            // @ts-expect-error incorrect type after pipe
            .pipe(async function* Step2(s: AsyncGenerator<number>) {
                yield* s
            })

        expect(p2).toBeTruthy() // avoid unused warning

        const p3 = new Pipeline(generate())
            .pipe(async function* Step1(s) {
                for await (const msg of s) {
                    yield String(msg) // change output type
                }
            })
            .pipe(async function* Step2(s) {
                yield* s
            })

        for await (const msg of p3) {
            // @ts-expect-error incorrect iteration type, should be string
            const v: number = msg
            expect(typeof v).toEqual('string')
        }

        const p4 = new Pipeline(generate())
            .pipe(async function* Step1(s) {
                for await (const msg of s) {
                    yield String(msg) // change output type
                }
            })

        for await (const msg of p4) {
            const v: string = msg
            expect(typeof v).toEqual('string')
        }

        const p5 = new Pipeline(generate())
            .pipe(async function* Step1(s) {
                for await (const msg of s) {
                    yield String(msg) // change output type
                }
            })
            // @ts-expect-error expects same as input type
            .pipeBefore(async function* Step0(s) {
                for await (const msg of s) {
                    yield String(msg) // change output type
                }
            })

        expect(p5).toBeTruthy() // avoid unused warning

        const p6 = new Pipeline(generate())
            .pipe(async function* Step3(s) {
                for await (const msg of s) {
                    yield String(msg) // change output type
                }
            })
            .pipeBefore(async function* Step0(s) {
                for await (const msg of s) {
                    if (msg % 2) {
                        continue // remove every other item
                    }

                    yield msg
                }
            })
            .pipeBefore(async function* Step2(s) {
                for await (const msg of s) {
                    yield msg * 2
                }
            })
            .pipeBefore(async function* Step1(s) {
                for await (const msg of s) {
                    yield msg - 1
                }
            })

        const received = []
        for await (const msg of p6) {
            const v: string = msg
            expect(typeof v).toEqual('string')
            received.push(msg)
        }
        const expectedResult: string[] = expected
            .filter((_v, index) => index % 2) // remove every other item
            .map((v) => (
                String( // 3. then convert to string
                    (v * 2) // 1. muliplication first
                    - 1 // 2. then -1
                )
            ))

        expect(received).toEqual(expectedResult)
    })

    describe('with finally handling', () => {
        let onFinally: () => void
        let onFinallyAfter: () => void

        beforeEach(() => {
            onFinallyAfter = jest.fn()
            onFinally = jest.fn(async () => {
                await wait(WAIT)
                onFinallyAfter()
            })
        })

        afterEach(() => {
            expect(onFinally).toHaveBeenCalledTimes(1)
            expect(onFinallyAfter).toHaveBeenCalledTimes(1)
        })
        describe('Pipeline', () => {
            describe('baseline', () => {
                IteratorTest('single step with onFinally', () => {
                    return new Pipeline(generate())
                        .pipe(async function* Step(src) {
                            yield* src
                        })
                        .onFinally(onFinally)
                })

                IteratorTest('multiple steps with onFinally', () => {
                    return new Pipeline(generate())
                        .pipe(async function* Step1(s) {
                            for await (const msg of s) {
                                yield msg + 2
                            }
                        })
                        .pipe(async function* Step2(s) {
                            for await (const msg of s) {
                                yield msg - 2
                            }
                        })
                        .onFinally(onFinally)
                })
            })

            it('feeds items from one to next', async () => {
                const receivedStep1: number[] = []
                const receivedStep2: number[] = []
                const afterStep1 = jest.fn()
                const afterStep2 = jest.fn()
                const p = new Pipeline(generate())
                    .pipe(async function* Step1(s) {
                        try {
                            for await (const msg of s) {
                                receivedStep1.push(msg)
                                yield msg * 2
                            }
                        } finally {
                            afterStep1()
                        }
                    })
                    .pipe(async function* Step2(s) {
                        try {
                            for await (const msg of s) {
                                receivedStep2.push(msg)
                                yield msg * 10
                            }
                        } finally {
                            // ensure async finally works
                            await wait(WAIT)
                            afterStep2()
                        }
                    })
                    .onFinally(onFinally)

                const received = []
                for await (const msg of p) {
                    received.push(msg)
                }

                expect(received).toEqual(expected.map((v) => v * 20))
                expect(receivedStep2).toEqual(expected.map((v) => v * 2))
                expect(receivedStep1).toEqual(expected)
                expect(afterStep1).toHaveBeenCalledTimes(1)
                expect(afterStep2).toHaveBeenCalledTimes(1)
            })

            it('feeds items from one to next, stops all when middle ends', async () => {
                const receivedStep1: number[] = []
                const receivedStep2: number[] = []
                const afterStep0 = jest.fn()
                const afterStep2 = jest.fn()
                const p = new Pipeline(generate())
                    .pipe(async function* Step0(s) {
                        try {
                            yield* s
                        } finally {
                            afterStep0()
                        }
                    })
                    .pipe(async function* Step1(s) {
                        for await (const msg of s) {
                            receivedStep1.push(msg)
                            yield msg * 2
                            if (receivedStep1.length === MAX_ITEMS) {
                                break
                            }
                        }
                    })
                    .pipe(async function* Step2(s) {
                        try {
                            for await (const msg of s) {
                                receivedStep2.push(msg)
                                yield String(msg * 10) // change type
                            }
                        } finally {
                            // ensure async finally works
                            await wait(WAIT)
                            afterStep2()
                        }
                    })
                    .onFinally(onFinally)

                const received = []
                for await (const msg of p) {
                    received.push(msg)
                }
                expect(received).toEqual(expected.slice(0, MAX_ITEMS).map((v) => String(v * 20)))
                expect(receivedStep2).toEqual(expected.slice(0, MAX_ITEMS).map((v) => v * 2))
                expect(receivedStep1).toEqual(expected.slice(0, MAX_ITEMS))
                expect(afterStep0).toHaveBeenCalledTimes(1)
                expect(afterStep2).toHaveBeenCalledTimes(1)
            })

            it('feeds items from one to next, stops all when middle throws', async () => {
                const err = new Error('expected')
                const receivedStep1: number[] = []
                const receivedStep2: number[] = []
                const afterStep0 = jest.fn()
                const afterStep2 = jest.fn()
                const p = new Pipeline(generate())
                    .pipe(async function* Step0(s) {
                        try {
                            yield* s
                        } finally {
                            afterStep0()
                        }
                    })
                    .pipe(async function* Step1(s) {
                        for await (const msg of s) {
                            receivedStep1.push(msg)
                            yield msg * 2
                            if (receivedStep1.length === MAX_ITEMS) {
                                throw err
                            }
                        }
                    })
                    .pipe(async function* Step2(s) {
                        try {
                            for await (const msg of s) {
                                receivedStep2.push(msg)
                                yield msg * 10
                            }
                        } finally {
                            // ensure async finally works
                            await wait(WAIT)
                            afterStep2()
                        }
                    })
                    .onFinally(onFinally)

                const received: number[] = []
                await expect(async () => {
                    for await (const msg of p) {
                        received.push(msg)
                    }
                }).rejects.toThrow(err)

                expect(received).toEqual(expected.slice(0, MAX_ITEMS).map((v) => v * 20))
                expect(receivedStep2).toEqual(expected.slice(0, MAX_ITEMS).map((v) => v * 2))
                expect(receivedStep1).toEqual(expected.slice(0, MAX_ITEMS))
                expect(afterStep0).toHaveBeenCalledTimes(1)
                expect(afterStep2).toHaveBeenCalledTimes(1)
            })

            it('handles errors before', async () => {
                const err = new Error('expected')

                const p = new Pipeline(generate())
                    .pipe(async function* Step1(s) {
                        yield* s
                        throw err
                    })
                    .pipe(async function* Step2(s) {
                        yield* s
                        yield await new Promise<number>(() => {}) // would wait forever
                    })
                    .onFinally(onFinally)

                const received: number[] = []
                await expect(async () => {
                    for await (const msg of p) {
                        received.push(msg)
                    }
                }).rejects.toThrow(err)

                expect(received).toEqual(expected)
            })

            it('handles errors in source', async () => {
                const err = new Error('expected')

                const p = new Pipeline((async function* generateError() {
                    yield* generate()
                    throw err
                }()))
                    .pipe(async function* Step1(s) {
                        yield* s
                    })
                    .pipe(async function* Step2(s) {
                        yield* s
                        yield await new Promise<number>(() => {}) // would wait forever
                    })
                    .onFinally(onFinally)

                const received: number[] = []
                await expect(async () => {
                    for await (const msg of p) {
                        received.push(msg)
                    }
                }).rejects.toThrow(err)

                expect(received).toEqual(expected)
            })

            it('handles errors after', async () => {
                const err = new Error('expected')

                const p = new Pipeline(generate())
                    .pipe(async function* Step1(s) {
                        yield* s
                    })
                    .pipe(async function* Step2(s) {
                        yield* s
                        throw err
                    })
                    .onFinally(onFinally)

                const received: number[] = []
                await expect(async () => {
                    for await (const msg of p) {
                        received.push(msg)
                    }
                }).rejects.toThrow(err)

                expect(received).toEqual(expected)
            })

            it('works with PullBuffer inputs', async () => {
                const onFinallyInnerAfter = jest.fn()
                const onFinallyInner = jest.fn(async () => {
                    await wait(WAIT)
                    onFinallyInnerAfter()
                })
                const inputStream = new PullBuffer(generate())
                const p = new Pipeline(inputStream)
                    .pipe(async function* Step1(s) {
                        yield* s
                    })
                    .pipe(async function* finallyFn(s) {
                        yield* iteratorFinally(s, onFinallyInner)
                    })
                    .onFinally(onFinally)

                const received = []
                for await (const msg of p) {
                    received.push(msg)
                }

                expect(onFinallyInner).toHaveBeenCalledTimes(1)
                expect(onFinallyInnerAfter).toHaveBeenCalledTimes(1)
                expect(received).toEqual(expected)
            })

            it('works with PushBuffer inputs', async () => {
                const onFinallyInnerAfter = jest.fn()
                const onFinallyInner = jest.fn(async () => {
                    await wait(WAIT)
                    onFinallyInnerAfter()
                })
                const inputStream = new PushBuffer<number>(1)

                setTimeout(async () => {
                    for await (const v of generate()) {
                        await inputStream.push(v)
                    }
                    inputStream.end()
                })

                const p = new Pipeline(inputStream)
                    .pipe(async function* Step1(s) {
                        for await (const v of s) {
                            yield v
                        }
                    })
                    .pipe(async function* finallyFn(s) {
                        yield* iteratorFinally(s, onFinallyInner)
                    })
                    .onFinally(onFinally)

                const received: number[] = []
                for await (const msg of p) {
                    received.push(msg)
                }

                expect(onFinallyInner).toHaveBeenCalledTimes(1)
                expect(onFinallyInnerAfter).toHaveBeenCalledTimes(1)
                expect(received).toEqual(expected)
            })

            it('works with PushBuffer inputs that throw', async () => {
                const err = new Error('expected')
                const onFinallyInnerAfter = jest.fn()
                const onFinallyInner = jest.fn(async () => {
                    await wait(WAIT)
                    onFinallyInnerAfter()
                })
                const inputStream = new PushBuffer<number>(1)

                setTimeout(async () => {
                    for await (const v of generate()) {
                        await inputStream.push(v)
                    }
                    inputStream.end(err)
                })

                const p = new Pipeline(inputStream)
                    .pipe(async function* Step1(s) {
                        for await (const v of s) {
                            yield v
                        }
                    })
                    .pipe(async function* finallyFn(s) {
                        yield* iteratorFinally(s, onFinallyInner)
                    })
                    .onFinally(onFinally)
                const received: number[] = []
                await expect(async () => {
                    for await (const msg of p) {
                        received.push(msg)
                    }
                }).rejects.toThrow(err)

                expect(received).toEqual(expected)
                expect(onFinallyInner).toHaveBeenCalledTimes(1)
                expect(onFinallyInnerAfter).toHaveBeenCalledTimes(1)
            })

            it('works with nested pipelines', async () => {
                const onFinallyInnerAfter = jest.fn()
                const onFinallyInner = jest.fn(async () => {
                    await wait(WAIT)
                    onFinallyInnerAfter()
                })

                const receivedStep1: number[] = []
                const receivedStep2: number[] = []

                const firstStream = new PullBuffer(generate())
                const p = new Pipeline(firstStream)
                    .pipe(async function* Step2(src) {
                        yield* new Pipeline(src)
                            .pipe(async function* Step1(s) {
                                for await (const msg of s) {
                                    receivedStep1.push(msg)
                                    yield msg
                                }
                            })
                            .onFinally(onFinallyInner)
                    })
                    .pipe(async function* Step2(s) {
                        for await (const msg of s) {
                            receivedStep2.push(msg)
                            yield msg
                        }
                    })
                    .onFinally(onFinally)

                const received = []
                for await (const msg of p) {
                    received.push(msg)
                }

                expect(onFinallyInner).toHaveBeenCalledTimes(1)
                expect(onFinallyInnerAfter).toHaveBeenCalledTimes(1)

                expect(received).toEqual(expected)
                expect(receivedStep1).toEqual(expected)
                expect(receivedStep2).toEqual(expected)
            })

            it('works with nested pipelines that throw', async () => {
                const onFinallyInnerAfter = jest.fn()
                const onFinallyInner = jest.fn(async () => {
                    await wait(WAIT)
                    onFinallyInnerAfter()
                })

                const receivedStep1: number[] = []
                const receivedStep2: number[] = []
                const err = new Error('expected err')

                const firstStream = new PullBuffer(generate())
                const p = new Pipeline(firstStream)
                    .pipe(async function* Step2(src) {
                        yield* new Pipeline(src)
                            .pipe(async function* Step1(s) {
                                for await (const msg of s) {
                                    receivedStep1.push(msg)
                                    yield msg
                                    if (receivedStep1.length === MAX_ITEMS) {
                                        throw err
                                    }
                                }
                            })
                            .onFinally(onFinallyInner)
                    })
                    .pipe(async function* Step2(s) {
                        for await (const msg of s) {
                            receivedStep2.push(msg)
                            yield msg
                        }
                    })
                    .onFinally(onFinally)

                const received: number[] = []

                await expect(async () => {
                    for await (const msg of p) {
                        received.push(msg)
                    }
                }).rejects.toThrow(err)

                expect(onFinallyInner).toHaveBeenCalledTimes(1)
                expect(onFinallyInnerAfter).toHaveBeenCalledTimes(1)

                expect(received).toEqual(expected.slice(0, MAX_ITEMS))
                expect(receivedStep1).toEqual(received)
                expect(receivedStep2).toEqual(received)
            })
        })

        describe('PushPipeline', () => {
            IteratorTest('single step with onFinally', () => {
                const pipeline = new PushPipeline().pipe(async function* Step1(s) {
                    yield* s
                }).onFinally(onFinally)

                pipeline.pull(generate())
                return pipeline
            })
        })
    })
})