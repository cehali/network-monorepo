import { fastPrivateKey, wait } from 'streamr-test-utils'
import { StreamMessage } from 'streamr-client-protocol'
import {
    Debug,
    createTestStream,
} from '../test-utils/utils'
import {
    getPublishTestStreamMessages
} from '../test-utils/publish'
import { Defer } from '../../src/utils/Defer'
import { pLimitFn } from '../../src/utils/promises'
import { StreamrClient } from '../../src/StreamrClient'
import { GroupKey } from '../../src/encryption/GroupKey'
import { Stream } from '../../src/Stream'
import { StreamPermission } from '../../src/permission'
import { DOCKER_DEV_STORAGE_NODE } from '../../src/ConfigTest'
import { ClientFactory, createClientFactory } from '../test-utils/fake/fakeEnvironment'
import { PublishPipeline } from '../../src/publish/PublishPipeline'

const debug = Debug('StreamrClient::test')
const TIMEOUT = 15 * 1000
const NUM_MESSAGES = 5

jest.setTimeout(30000)

const getPublishPipeline = (client: StreamrClient): PublishPipeline => {
    // @ts-expect-error private
    return client.container.resolve(PublishPipeline)
}

const testMessageEncryptionType = (streamMessage: StreamMessage) => {
    if (streamMessage.messageType === StreamMessage.MESSAGE_TYPES.MESSAGE) {
        expect(streamMessage.encryptionType).toEqual(StreamMessage.ENCRYPTION_TYPES.AES)
    } else if (streamMessage.messageType === StreamMessage.MESSAGE_TYPES.GROUP_KEY_RESPONSE) {
        expect(streamMessage.encryptionType).toEqual(StreamMessage.ENCRYPTION_TYPES.RSA)
    } else {
        expect(streamMessage.encryptionType).toEqual(StreamMessage.ENCRYPTION_TYPES.NONE)
    }
}

describe.skip('decryption', () => { // TODO enable the test when it doesn't depend on PublishPipeline
    let publishTestMessages: ReturnType<typeof getPublishTestStreamMessages>
    let expectErrors = 0 // check no errors by default
    let errors: Error[] = []

    let publisher: StreamrClient
    let publisherPrivateKey: string
    let subscriber: StreamrClient
    let subscriberPrivateKey: string
    let stream: Stream
    let clientFactory: ClientFactory

    beforeEach(() => {
        clientFactory = createClientFactory()
        errors = []
        expectErrors = 0
    })

    afterEach(async () => {
        await wait(0)
        // ensure no unexpected errors
        expect(errors).toHaveLength(expectErrors)
    })

    async function setupClient(opts?: any) {
        const client = clientFactory.createClient(opts)
        await Promise.all([
            client.connect(),
        ])
        return client
    }

    async function setupStream() {
        stream = await createTestStream(publisher, module)
        await stream.addToStorageNode(DOCKER_DEV_STORAGE_NODE)
        publishTestMessages = getPublishTestStreamMessages(publisher, stream)
    }

    async function setupPublisherSubscriberClients(opts?: any) {
        debug('set up clients', opts)
        if (publisher) {
            debug('disconnecting old publisher')
            await publisher.destroy()
        }

        if (subscriber) {
            debug('disconnecting old subscriber')
            await subscriber.destroy()
        }

        publisherPrivateKey = fastPrivateKey()
        subscriberPrivateKey = fastPrivateKey()
        // eslint-disable-next-line require-atomic-updates, semi-style, no-extra-semi
        ;[publisher, subscriber] = await Promise.all([
            setupClient({
                id: 'publisher',
                auth: {
                    privateKey: publisherPrivateKey
                },
                ...opts
            }),
            setupClient({
                id: 'subscriber',
                auth: {
                    privateKey: subscriberPrivateKey
                },
                ...opts
            })
        ])
    }

    // run these in sequence (i.e. pLimitFn(fn, 1)) because core-api can't handle concurrency here
    const grantSubscriberPermissions = pLimitFn(async ({
        stream: s = stream,
        client: c = subscriber,
    }: { stream?: Stream, client?: StreamrClient } = {}) => {
        const p2 = await s.grantPermissions({ user: await c.getAddress(), permissions: [StreamPermission.SUBSCRIBE] })
        return [p2]
    })

    const collectMessages = async (
        testStream: Stream
    ): Promise<{ done: Promise<any>, received: any[] }> => {
        const done = Defer()
        const received: any = []
        await grantSubscriberPermissions({ stream: testStream })
        await subscriber.subscribe({
            streamId: testStream.id,
        }, (parsedContent) => {
            received.push(parsedContent)
            if (received.length === NUM_MESSAGES) {
                done.resolve(undefined)
            }
        })
        return {
            done,
            received
        }
    }

    describe('using default config', () => {
        beforeEach(async () => {
            await setupPublisherSubscriberClients()
            await setupStream()
        }, 60000)

        it('errors if rotating group key for no stream', async () => {
            await expect(async () => (
                // @ts-expect-error invalid argument
                publisher.updateEncryptionKey()
            )).rejects.toThrow('streamId')
        })

        it('errors if setting group key for no stream', async () => {
            await expect(async () => {
                await publisher.updateEncryptionKey({
                    // @ts-expect-error invalid argument
                    streamId: undefined,
                    key: GroupKey.generate(),
                    distributionMethod: 'rotate'
                })
            }).rejects.toThrow('streamId')
        })

        it('sets group key per-stream', async () => {
            const stream2 = await createTestStream(publisher, module)

            function checkEncryptionMessagesPerStream(testClient: StreamrClient) {
                const onSendTest = Defer()
                // @ts-expect-error private
                getPublishPipeline(testClient).publishQueue.forEach(onSendTest.wrapError(async ([streamMessage]) => {
                    testClient.debug({ streamMessage })

                    if (streamMessage.getStreamId() === stream2.id) {
                        expect(streamMessage.groupKeyId).toEqual(groupKey2.id)
                    }

                    if (streamMessage.getStreamId() === stream.id) {
                        expect(streamMessage.groupKeyId).toEqual(groupKey.id)
                    }
                    testMessageEncryptionType(streamMessage)
                })).onFinally.listen(() => {
                    onSendTest.resolve(undefined)
                })

                return onSendTest
            }

            async function testSub(testStream: Stream) {
                const { done, received } = await collectMessages(testStream)

                const contentClear: any[] = []
                // @ts-expect-error private
                getPublishPipeline(publisher).streamMessageQueue.onMessage.listen(([streamMessage]) => {
                    if (streamMessage.getStreamId() !== testStream.id) { return }
                    contentClear.push(streamMessage.getParsedContent())
                })
                await getPublishTestStreamMessages(publisher, testStream)(NUM_MESSAGES)

                await done

                expect(received).toEqual(contentClear)
            }

            const onEncryptionMessageErr = checkEncryptionMessagesPerStream(publisher)

            const groupKey = GroupKey.generate()
            await publisher.updateEncryptionKey({
                streamId: stream.id,
                key: groupKey,
                distributionMethod: 'rotate'
            })
            const groupKey2 = GroupKey.generate()
            await publisher.updateEncryptionKey({
                streamId: stream2.id,
                key: groupKey2,
                distributionMethod: 'rotate'
            })

            await testSub(stream)
            await testSub(stream2)
            onEncryptionMessageErr.resolve(undefined)
            await onEncryptionMessageErr
        }, TIMEOUT * 2)
    })

    describe('revoking permissions', () => {
        async function testRevokeDuringSubscribe({
            maxMessages = 6,
            revokeAfter = Math.round(maxMessages / 2),
        }: {
            maxMessages?: number
            revokeAfter?: number
        } = {}) {
            // this has publisher & subscriber clients
            // publisher begins publishing `maxMessages` messages
            // subscriber recieves messages
            // after publisher publishes `revokeAfter` messages,
            // and subscriber receives the last message
            // subscriber has subscribe permission removed
            // and publisher rekeys the stream.
            // Publisher then keep publishing messages with the new key.
            // The subscriber should error on the next message, and unsubscribe
            // due to permission change.
            // check that subscriber got just the messages from before permission revoked
            // and subscriber errored with something about group key or
            // permissions

            await publisher.updateEncryptionKey({
                streamId: stream.id,
                distributionMethod: 'rotate'
            })

            await stream.grantPermissions({
                user: await subscriber.getAddress(),
                permissions: [StreamPermission.SUBSCRIBE]
            })

            const sub = await subscriber.subscribe({
                stream: stream.id,
            })

            const errs: Error[] = []
            const onSubError = jest.fn((err: Error) => {
                errs.push(err)
                throw err // this should trigger unsub
            })

            sub.onError.listen(onSubError)

            const received: any[] = []
            // Publish after subscribed
            let count = 0
            const gotMessages = Defer()
            // do publish in background otherwise permission is revoked before subscriber starts processing
            const publishTask = publishTestMessages(maxMessages, {
                timestamp: 1111111,
                async afterEach() {
                    count += 1
                    publisher.debug('PUBLISHED %d of %d', count, maxMessages)
                    if (count === revokeAfter) {
                        await gotMessages
                        await stream.revokePermissions({
                            user: await subscriber.getAddress(),
                            permissions: [StreamPermission.SUBSCRIBE]
                        })
                        await publisher.updateEncryptionKey({
                            streamId: stream.id,
                            distributionMethod: 'rekey'
                        })
                    }
                }
            })
            publishTask.catch(() => {})

            subscriber.debug('\n\n1\n\n')
            let t!: ReturnType<typeof setTimeout>
            const timedOut = jest.fn()
            try {
                await expect(async () => {
                    for await (const m of sub) {
                        received.push(m)
                        subscriber.debug('RECEIVED %d of %d', received.length, maxMessages)
                        if (received.length === revokeAfter) {
                            gotMessages.resolve(undefined)
                            clearTimeout(t)
                            t = setTimeout(() => {
                                timedOut()
                                sub.unsubscribe().catch(() => {})
                            }, 600000)
                        }

                        if (received.length === maxMessages) {
                            clearTimeout(t)
                            break
                        }
                    }
                }).rejects.toThrow(/not a subscriber|Could not get GroupKey/)
            } catch (e) {
                debug(e)
            } finally {
                clearTimeout(t)
                // run in finally to ensure publish promise finishes before
                // continuing no matter the result of the expect call above
                const published = await publishTask.catch((err) => {
                    publisher.debug('catch', err)
                    return []
                })

                expect(timedOut).toHaveBeenCalledTimes(0)
                expect(received).toEqual([
                    ...published.slice(0, revokeAfter),
                ])

                expect(onSubError).toHaveBeenCalledTimes(1)
            }
        }
        describe('very low cache maxAge', () => {
            beforeEach(async () => {
                await setupPublisherSubscriberClients({
                    cache: {
                        maxAge: 100,
                    }
                })
            })
            beforeEach(async () => {
                await setupStream()
            })
            it('fails gracefully if permission revoked after first message', async () => {
                await testRevokeDuringSubscribe({ maxMessages: 3, revokeAfter: 1 })
            })
            it('fails gracefully if permission revoked after some messages', async () => {
                await testRevokeDuringSubscribe({ maxMessages: 6, revokeAfter: 3 })
            })
        })

        describe('low cache maxAge', () => {
            beforeEach(async () => {
                await setupPublisherSubscriberClients({
                    cache: {
                        maxAge: 2000,
                    }
                })
            })
            beforeEach(async () => {
                await setupStream()
            })
            it('fails gracefully if permission revoked after first message', async () => {
                await testRevokeDuringSubscribe({ maxMessages: 3, revokeAfter: 1 })
            })
            it('fails gracefully if permission revoked after some messages', async () => {
                await testRevokeDuringSubscribe({ maxMessages: 6, revokeAfter: 3 })
            })
        })

        describe('high cache maxAge', () => {
            beforeEach(async () => {
                await setupPublisherSubscriberClients({
                    cache: {
                        maxAge: 9999999,
                    }
                })
            })

            beforeEach(async () => {
                await setupStream()
            })

            it('fails gracefully if permission revoked after first message', async () => {
                await testRevokeDuringSubscribe({ maxMessages: 6, revokeAfter: 1 })
            })

            it('fails gracefully if permission revoked after some messages', async () => {
                await testRevokeDuringSubscribe({ maxMessages: 6, revokeAfter: 3 })
            })
        })
    })
})
