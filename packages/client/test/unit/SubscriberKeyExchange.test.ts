import 'reflect-metadata'
import { DependencyContainer } from 'tsyringe'
import { 
    EthereumAddress,
    GroupKeyRequestSerialized,
    KeyExchangeStreamIDUtils,
    MessageID,
    SigningUtil,
    StreamMessage,
    StreamPartIDUtils,
} from 'streamr-client-protocol'
import { StreamRegistry } from '../../src/StreamRegistry'
import { GroupKey } from '../../src/encryption/GroupKey'
import { createGroupKeyResponse } from '../../src/encryption/PublisherKeyExchange'
import { Wallet } from 'ethers'
import { Stream } from '../../src/Stream'
import { StreamPermission } from '../../src/permission'
import { SubscriberKeyExchange } from '../../src/encryption/SubscriberKeyExchange'
import { addFakeNode, createFakeContainer } from '../test-utils/fake/fakeEnvironment'

const MOCK_GROUP_KEY = new GroupKey('mock-group-key-id', Buffer.from('mock-group-key-256-bits---------'))

const createMockStream = async (
    publisherAddress: EthereumAddress,
    fakeContainer: DependencyContainer
) => {
    const streamRegistry = fakeContainer.resolve(StreamRegistry)
    const stream = await streamRegistry.createStream(StreamPartIDUtils.parse('stream#0'))
    streamRegistry.grantPermissions(stream.id, {
        permissions: [StreamPermission.PUBLISH],
        user: publisherAddress
    })
    return stream
}

const createMockGroupKeyResponse = async (
    groupKeyRequest: StreamMessage<GroupKeyRequestSerialized>,
    publisherWallet: Wallet
): Promise<StreamMessage> => {
    const subscriberAddress = groupKeyRequest.getPublisherId()
    const subscriberKeyExchangeStreamPartId = KeyExchangeStreamIDUtils.formStreamPartID(subscriberAddress)
    const msg = new StreamMessage({
        messageId: new MessageID(
            StreamPartIDUtils.getStreamID(subscriberKeyExchangeStreamPartId),
            StreamPartIDUtils.getStreamPartition(subscriberKeyExchangeStreamPartId),
            0,
            0,
            publisherWallet.address,
            'msgChainId'
        ),
        content: (await createGroupKeyResponse(
            groupKeyRequest,
            async () => MOCK_GROUP_KEY,
            async () => true
        )).serialize(),
        messageType: StreamMessage.MESSAGE_TYPES.GROUP_KEY_RESPONSE,
        encryptionType: StreamMessage.ENCRYPTION_TYPES.RSA
    })
    msg.signature = SigningUtil.sign(msg.getPayloadToSign(StreamMessage.SIGNATURE_TYPES.ETH), publisherWallet.privateKey)
    return msg
}

describe('SubscriberKeyExchange', () => {

    let publisherWallet: Wallet
    let subscriberWallet: Wallet
    let mockStream: Stream
    let fakeContainer: DependencyContainer

    beforeAll(async () => {
        publisherWallet = Wallet.createRandom()
        subscriberWallet = Wallet.createRandom()
        fakeContainer = createFakeContainer({
            auth: {
                privateKey: subscriberWallet.privateKey
            }
        })
        mockStream = await createMockStream(publisherWallet.address, fakeContainer)
    })

    /*
     * A subscriber node requests a group key by calling subscriberKeyExchange.getGroupKey()
     * - tests that a correct kind of request message is sent to a publisher node
     * - tests that we can parse the group key from the response sent by the publisher
     */
    it('requests a group key', async () => {
        const publisherNode = addFakeNode(publisherWallet.address, fakeContainer)
        const publisherKeyExchangeStreamPartId = KeyExchangeStreamIDUtils.formStreamPartID(publisherWallet.address)
        const receivedMessages = publisherNode.addSubscriber(publisherKeyExchangeStreamPartId)
    
        const subscriberKeyExchange = fakeContainer.resolve(SubscriberKeyExchange)
        const receivedGroupKey = subscriberKeyExchange.getGroupKey({
            getStreamId: () => mockStream.id,
            getPublisherId: () => publisherWallet.address,
            groupKeyId: MOCK_GROUP_KEY.id
        } as any)
        
        const groupKeyRequest = await receivedMessages.pop()
        expect(groupKeyRequest).toMatchObject({
            messageId: {
                streamId: StreamPartIDUtils.getStreamID(publisherKeyExchangeStreamPartId),
                streamPartition:  StreamPartIDUtils.getStreamPartition(publisherKeyExchangeStreamPartId),
                publisherId: subscriberWallet.address.toLowerCase()
            },
            messageType: StreamMessage.MESSAGE_TYPES.GROUP_KEY_REQUEST,
            contentType: StreamMessage.CONTENT_TYPES.JSON,
            encryptionType: StreamMessage.ENCRYPTION_TYPES.NONE,
            signatureType: StreamMessage.SIGNATURE_TYPES.ETH,
            signature: expect.any(String)
        })
        expect(groupKeyRequest.getParsedContent()).toEqual([
            expect.any(String),
            mockStream.id,
            expect.any(String),
            [ MOCK_GROUP_KEY.id ]
        ])
        
        const groupKeyResponse = await createMockGroupKeyResponse(groupKeyRequest as any, publisherWallet) 
        publisherNode.publishToNode(groupKeyResponse)
        
        expect((await receivedGroupKey)!).toEqual(MOCK_GROUP_KEY)
    })
})