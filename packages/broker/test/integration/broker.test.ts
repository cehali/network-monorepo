import { startTracker, Tracker } from 'streamr-network'
import fetch from 'node-fetch'
import { Wallet } from 'ethers'
import { wait, waitForCondition } from 'streamr-test-utils'
import {
    createClient,
    createTestStream,
    startBroker,
    StorageAssignmentEventManager,
    until,
    waitForStreamPersistedInStorageNode
} from '../utils'
import { Todo } from '../types'
import StreamrClient, { Stream, StreamOperation } from 'streamr-client'
import { Broker } from '../broker'
import storagenodeConfig = require('./storageNodeConfig.json')

const httpPort = 12341
const wsPort1 = 12351
const wsPort2 = 12352
const wsPort3 = 12353
const trackerPort = 12370

jest.setTimeout(60000)

describe('broker: end-to-end', () => {
    let tracker: Tracker
    let storageNode: Broker
    let brokerNode1: Broker
    let brokerNode2: Broker
    let client1: StreamrClient
    let client2: StreamrClient
    let client3: StreamrClient
    let freshStream: Stream
    let freshStreamId: string
    let assignmentEventManager: StorageAssignmentEventManager

    beforeAll(async () => {
        const storageNodeAccount = new Wallet('0x2cd9855d17e01ce041953829398af7e48b24ece04ff9d0e183414de54dc52285')
        const engineAndEditorAccount = new Wallet('0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0')
        const storageNodeRegistry = {
            contractAddress: '0xbAA81A0179015bE47Ad439566374F2Bae098686F',
            jsonRpcProvider: `http://10.200.10.1:8546`
        }
        tracker = await startTracker({
            host: '127.0.0.1',
            port: trackerPort,
            id: 'tracker-1'
        })
        const storageNodeClient = new StreamrClient({
            auth: {
                privateKey: storageNodeAccount.privateKey
            },
        })
        await storageNodeClient.setNode('http://127.0.0.1:' + httpPort)
        storageNode = await startBroker(
            {
                name: 'storageNode',
                privateKey: storagenodeConfig.ethereumPrivateKey,
                trackerPort,
                httpPort,
                wsPort1,
                enableCassandra: true,
                ...storagenodeConfig
            }
        )       

        brokerNode1 = await startBroker({
            name: 'brokerNode1',
            privateKey: '0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae',
            trackerPort,
            wsPort: wsPort2,
            streamrAddress: engineAndEditorAccount.address,
            enableCassandra: false,
            storageNodeConfig: { registry: storageNodeRegistry }
        })
        brokerNode2 = await startBroker({
            name: 'brokerNode2',
            privateKey: '0x633a182fb8975f22aaad41e9008cb49a432e9fdfef37f151e9e7c54e96258ef9',
            trackerPort,
            wsPort: wsPort3,
            streamrAddress: engineAndEditorAccount.address,
            enableCassandra: false,
            storageNodeConfig: { registry: storageNodeRegistry }
        })

        // Create clients
        const user1 = new Wallet('0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')
        const user2 = new Wallet('0xd7609ae3a29375768fac8bc0f8c2f6ac81c5f2ffca2b981e6cf15460f01efe14')
        client1 = createClient(tracker, user1.privateKey, {
            storageNodeRegistry: storageNodeRegistry
        })
        client2 = createClient(tracker, user1.privateKey, {
            storageNodeRegistry: storageNodeRegistry
        })
        client3 = createClient(tracker, user2.privateKey, {
            storageNodeRegistry: storageNodeRegistry
        })
        assignmentEventManager = new StorageAssignmentEventManager(tracker, engineAndEditorAccount)
        await assignmentEventManager.createStream()

        // Set up stream
        freshStream = await createTestStream(client1, module)
        freshStreamId = freshStream.id
        await assignmentEventManager.addStreamToStorageNode(freshStreamId, storageNodeAccount.address, client1)
        await until(async () => { return client1.isStreamStoredInStorageNode(freshStreamId, storageNodeAccount.address) }, 100000, 1000)
        await waitForStreamPersistedInStorageNode(freshStreamId, 0, '127.0.0.1', httpPort)
        // await freshStream.grantPermission(StreamOperation.STREAM_SUBSCRIBE, user2.address)
    })

    afterAll(async () => {
        await Promise.allSettled([
            tracker.stop(),
            client1.disconnect(),
            client2.disconnect(),
            client3.disconnect(),
            storageNode.stop(),
            brokerNode1.stop(),
            brokerNode2.stop(),
            assignmentEventManager.close(),
        ])
    })

    it('happy-path: real-time websocket producing and websocket consuming (unsigned messages)', async () => {
        const client1Messages: Todo[] = []
        const client2Messages: Todo[] = []
        const client3Messages: Todo[] = []

        const subs = await Promise.all([
            client1.subscribe({
                stream: freshStreamId
            }, (message) => {
                client1Messages.push(message)
            }),
            client2.subscribe({
                stream: freshStreamId
            }, (message) => {
                client2Messages.push(message)
            }),
            client3.subscribe({
                stream: freshStreamId
            }, (message) => {
                client3Messages.push(message)
            })
        ])

        await Promise.all(subs.map((sub) => sub.waitForNeighbours()))

        await client1.publish(freshStreamId, {
            key: 1
        })
        await client1.publish(freshStreamId, {
            key: 2
        })
        await client1.publish(freshStreamId, {
            key: 3
        })

        await waitForCondition(() => client2Messages.length === 3 && client3Messages.length === 3)
        await waitForCondition(() => client1Messages.length === 3)

        expect(client1Messages).toEqual([
            {
                key: 1
            },
            {
                key: 2
            },
            {
                key: 3
            },
        ])

        expect(client2Messages).toEqual([
            {
                key: 1
            },
            {
                key: 2
            },
            {
                key: 3
            },
        ])

        expect(client3Messages).toEqual([
            {
                key: 1
            },
            {
                key: 2
            },
            {
                key: 3
            },
        ])
    })

    it('happy-path: real-time HTTP producing and websocket consuming', async () => {
        const client1Messages: Todo[] = []
        const client2Messages: Todo[] = []
        const client3Messages: Todo[] = []

        await Promise.all([
            client1.subscribe({
                stream: freshStreamId
            }, (message) => {
                client1Messages.push(message)
            }),
            client2.subscribe({
                stream: freshStreamId
            }, (message) => {
                client2Messages.push(message)
            }),
            client3.subscribe({
                stream: freshStreamId
            }, (message) => {
                client3Messages.push(message)
            })
        ])

        for (let i = 1; i <= 3; ++i) {
            client1.publish(freshStream, JSON.stringify({
                key: i
            }))
        }

        await waitForCondition(() => client2Messages.length === 3 && client3Messages.length === 3)
        await waitForCondition(() => client1Messages.length === 3)

        expect(client1Messages).toEqual([
            {
                key: 1
            },
            {
                key: 2
            },
            {
                key: 3
            },
        ])

        expect(client2Messages).toEqual([
            {
                key: 1
            },
            {
                key: 2
            },
            {
                key: 3
            },
        ])

        expect(client3Messages).toEqual([
            {
                key: 1
            },
            {
                key: 2
            },
            {
                key: 3
            },
        ])
    })

    it('happy-path: resend last request via websocket', async () => {
        const subs = await Promise.all([
            client1.subscribe({
                stream: freshStreamId
            }, () => {}),
            client2.subscribe({
                stream: freshStreamId
            }, () => {}),
            client3.subscribe({
                stream: freshStreamId
            }, () => {}),
        ])

        await Promise.all(subs.map((sub) => sub.waitForNeighbours()))

        await client1.publish(freshStreamId, {
            key: 1
        })
        await client1.publish(freshStreamId, {
            key: 2
        })
        await client1.publish(freshStreamId, {
            key: 3
        })
        await client1.publish(freshStreamId, {
            key: 4
        })

        await wait(3000) // wait for propagation

        const client1Messages: Todo[] = []
        const client2Messages: Todo[] = []
        const client3Messages: Todo[] = []

        await Promise.all([
            client1.resend({
                stream: freshStreamId,
                resend: {
                    last: 2
                }
            }, (message) => {
                client1Messages.push(message)
            }),
            client2.resend({
                stream: freshStreamId,
                resend: {
                    last: 2
                }
            }, (message) => {
                client2Messages.push(message)
            }),
            client3.resend({
                stream: freshStreamId,
                resend: {
                    last: 2
                }
            }, (message) => {
                client3Messages.push(message)
            })
        ])

        await waitForCondition(() => client2Messages.length === 2 && client3Messages.length === 2)
        await waitForCondition(() => client1Messages.length === 2)

        expect(client1Messages).toEqual([
            {
                key: 3
            },
            {
                key: 4
            },
        ])

        expect(client2Messages).toEqual([
            {
                key: 3
            },
            {
                key: 4
            },
        ])

        expect(client3Messages).toEqual([
            {
                key: 3
            },
            {
                key: 4
            },
        ])
    })

    it('happy-path: resend from request via websocket', async () => {
        await Promise.all([
            client1.subscribe({
                stream: freshStreamId
            }, () => {}),
            client2.subscribe({
                stream: freshStreamId
            }, () => {}),
            client3.subscribe({
                stream: freshStreamId
            }, () => {}),
        ])

        await client1.publish(freshStreamId, {
            key: 1
        })
        await wait(50)
        const timeAfterFirstMessagePublished = Date.now()

        await client1.publish(freshStreamId, {
            key: 2
        })
        await wait(50)
        await client1.publish(freshStreamId, {
            key: 3
        })
        await wait(50)
        await client1.publish(freshStreamId, {
            key: 4
        })

        await wait(1500) // wait for propagation

        const client1Messages: Todo[] = []
        const client2Messages: Todo[] = []
        const client3Messages: Todo[] = []
        await Promise.all([
            client1.resend({
                stream: freshStreamId,
                resend: {
                    from: {
                        timestamp: timeAfterFirstMessagePublished,
                    }
                }
            }, (message) => {
                client1Messages.push(message)
            }),
            client2.resend({
                stream: freshStreamId,
                resend: {
                    from: {
                        timestamp: timeAfterFirstMessagePublished,
                    }
                }
            }, (message) => {
                client2Messages.push(message)
            }),
            client3.resend({
                stream: freshStreamId,
                resend: {
                    from: {
                        timestamp: timeAfterFirstMessagePublished,
                    }
                }
            }, (message) => {
                client3Messages.push(message)
            })
        ])

        await waitForCondition(() => client2Messages.length === 3 && client3Messages.length === 3)
        await waitForCondition(() => client1Messages.length === 3)

        expect(client1Messages).toEqual([
            {
                key: 2
            },
            {
                key: 3
            },
            {
                key: 4
            },
        ])

        expect(client2Messages).toEqual([
            {
                key: 2
            },
            {
                key: 3
            },
            {
                key: 4
            },
        ])

        expect(client3Messages).toEqual([
            {
                key: 2
            },
            {
                key: 3
            },
            {
                key: 4
            },
        ])
    })

    it('happy-path: resend range request via websocket', async () => {
        await Promise.all([
            client1.subscribe({
                stream: freshStreamId
            }, () => {}),
            client2.subscribe({
                stream: freshStreamId
            }, () => {}),
            client3.subscribe({
                stream: freshStreamId
            }, () => {}),
        ])

        await client1.publish(freshStreamId, {
            key: 1
        })
        await wait(50)
        const timeAfterFirstMessagePublished = Date.now()

        await client1.publish(freshStreamId, {
            key: 2
        })
        await wait(50)
        await client1.publish(freshStreamId, {
            key: 3
        })
        await wait(25)
        const timeAfterThirdMessagePublished = Date.now()
        await wait(25)

        await client1.publish(freshStreamId, {
            key: 4
        })

        await wait(1500) // wait for propagation

        const client1Messages: Todo[] = []
        const client2Messages: Todo[] = []
        const client3Messages: Todo[] = []

        await Promise.all([
            client1.resend({
                stream: freshStreamId,
                resend: {
                    from: {
                        timestamp: timeAfterFirstMessagePublished,
                    },
                    to: {
                        timestamp: timeAfterThirdMessagePublished,
                    }
                }
            }, (message) => {
                client1Messages.push(message)
            }),

            client2.resend({
                stream: freshStreamId,
                resend: {
                    from: {
                        timestamp: timeAfterFirstMessagePublished,
                    },
                    to: {
                        timestamp: timeAfterThirdMessagePublished,
                    }
                }
            }, (message) => {
                client2Messages.push(message)
            }),

            client3.resend({
                stream: freshStreamId,
                resend: {
                    from: {
                        timestamp: timeAfterFirstMessagePublished,
                    },
                    to: {
                        timestamp: timeAfterThirdMessagePublished,
                    }
                }
            }, (message) => {
                client3Messages.push(message)
            })
        ])

        await waitForCondition(() => client2Messages.length === 2 && client3Messages.length === 2)
        await waitForCondition(() => client1Messages.length === 2)

        expect(client1Messages).toEqual([
            {
                key: 2
            },
            {
                key: 3
            },
        ])

        expect(client2Messages).toEqual([
            {
                key: 2
            },
            {
                key: 3
            },
        ])

        expect(client3Messages).toEqual([
            {
                key: 2
            },
            {
                key: 3
            },
        ])
    })

    it('happy-path: resend last request via http', async () => {
        await Promise.all([
            client1.subscribe({
                stream: freshStreamId
            }, () => {}),
            client2.subscribe({
                stream: freshStreamId
            }, () => {}),
            client3.subscribe({
                stream: freshStreamId
            }, () => {}),
        ])

        await client1.publish(freshStreamId, {
            key: 1
        })
        await client1.publish(freshStreamId, {
            key: 2
        })
        await client1.publish(freshStreamId, {
            key: 3
        })
        await client1.publish(freshStreamId, {
            key: 4
        })

        await wait(8000) // wait for propagation
        const url = `http://localhost:${httpPort}/api/v1/streams/${encodeURIComponent(freshStreamId)}/data/partitions/0/last?count=2`
        const response = await fetch(url, {
            method: 'get',
        })
        const messagesAsObjects = await response.json()
        const messageContents = messagesAsObjects.map((msgAsObject: Todo) => msgAsObject.content)

        expect(messageContents).toEqual([
            {
                key: 3
            },
            {
                key: 4
            },
        ])
    })

    it('broker streams long resend from request via http', async () => {
        const fromTimestamp = Date.now()

        const sentMessages = []
        for (let i = 0; i < 50; i++) {
            const msg = {
                key: i
            }
            // eslint-disable-next-line no-await-in-loop
            await client1.publish(freshStreamId, msg)
            sentMessages.push(msg)
        }

        await wait(8000)

        const url = `http://localhost:${httpPort}/api/v1/streams/${encodeURIComponent(freshStreamId)}/data/partitions/0/from?fromTimestamp=${fromTimestamp}`
        const response = await fetch(url, {
            method: 'get',
        })
        const messagesAsObjects = await response.json()
        const messages = messagesAsObjects.map((msgAsObject: Todo) => msgAsObject.content)

        expect(sentMessages).toEqual(messages)
    })

    it('broker returns [] for empty http resend', async () => {
        const fromTimestamp = Date.now() + 99999999
        const url = `http://localhost:${httpPort}/api/v1/streams/${encodeURIComponent(freshStreamId)}/data/partitions/0/from?fromTimestamp=${fromTimestamp}`
        const response = await fetch(url, {
            method: 'get',
        })
        const messagesAsObjects = await response.json()
        expect(messagesAsObjects).toEqual([])
    })

    it('happy-path: resend from request via http', async () => {
        await Promise.all([
            client1.subscribe({
                stream: freshStreamId
            }, () => {}),
            client2.subscribe({
                stream: freshStreamId
            }, () => {}),
            client3.subscribe({
                stream: freshStreamId
            }, () => {}),
        ])

        await client1.publish(freshStreamId, {
            key: 1
        })
        await wait(50)
        const timeAfterFirstMessagePublished = Date.now()

        await client1.publish(freshStreamId, {
            key: 2
        })
        await wait(50)
        await client1.publish(freshStreamId, {
            key: 3
        })
        await wait(50)
        await client1.publish(freshStreamId, {
            key: 4
        })

        await wait(1500) // wait for propagation

        const url = `http://localhost:${httpPort}/api/v1/streams/${encodeURIComponent(freshStreamId)}/data/partitions/0/from`
            + `?fromTimestamp=${timeAfterFirstMessagePublished}`
        const response = await fetch(url, {
            method: 'get',
        })
        const messagesAsObjects = await response.json()
        const messageContents = messagesAsObjects.map((msgAsObject: Todo) => msgAsObject.content)

        expect(messageContents).toEqual([
            {
                key: 2
            },
            {
                key: 3
            },
            {
                key: 4
            },
        ])
    })

    it('happy-path: resend range request via http', async () => {
        await Promise.all([
            client1.subscribe({
                stream: freshStreamId
            }, () => {}),
            client2.subscribe({
                stream: freshStreamId
            }, () => {}),
            client3.subscribe({
                stream: freshStreamId
            }, () => {}),
        ])

        await client1.publish(freshStreamId, {
            key: 1
        })
        await wait(50)
        const timeAfterFirstMessagePublished = Date.now()

        await client1.publish(freshStreamId, {
            key: 2
        })
        await wait(50)
        await client1.publish(freshStreamId, {
            key: 3
        })
        await wait(25)
        const timeAfterThirdMessagePublished = Date.now()
        await wait(25)

        await client1.publish(freshStreamId, {
            key: 4
        })

        await wait(1500) // wait for propagation

        const url = `http://localhost:${httpPort}/api/v1/streams/${encodeURIComponent(freshStreamId)}/data/partitions/0/range`
            + `?fromTimestamp=${timeAfterFirstMessagePublished}`
            + `&toTimestamp=${timeAfterThirdMessagePublished}`
        const response = await fetch(url, {
            method: 'get',
        })
        const messagesAsObjects = await response.json()
        const messageContents = messagesAsObjects.map((msgAsObject: Todo) => msgAsObject.content)

        expect(messageContents).toEqual([
            {
                key: 2
            },
            {
                key: 3
            },
        ])
    })
})
