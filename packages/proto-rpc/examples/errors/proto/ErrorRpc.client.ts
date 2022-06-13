// @generated by protobuf-ts 2.6.0 with parameter server_generic,generate_dependencies
// @generated from protobuf file "ErrorRpc.proto" (syntax proto3)
// tslint:disable
import type { RpcTransport } from "@protobuf-ts/runtime-rpc";
import type { ServiceInfo } from "@protobuf-ts/runtime-rpc";
import { ErrorRpc } from "./ErrorRpc";
import { stackIntercept } from "@protobuf-ts/runtime-rpc";
import type { HelloResponse } from "./ErrorRpc";
import type { HelloRequest } from "./ErrorRpc";
import type { UnaryCall } from "@protobuf-ts/runtime-rpc";
import type { RpcOptions } from "@protobuf-ts/runtime-rpc";
/**
 * @generated from protobuf service ErrorRpc
 */
export interface IErrorRpcClient {
    /**
     * @generated from protobuf rpc: timeout(HelloRequest) returns (HelloResponse);
     */
    timeout(input: HelloRequest, options?: RpcOptions): UnaryCall<HelloRequest, HelloResponse>;
    /**
     * @generated from protobuf rpc: serverError(HelloRequest) returns (HelloResponse);
     */
    serverError(input: HelloRequest, options?: RpcOptions): UnaryCall<HelloRequest, HelloResponse>;
    /**
     * @generated from protobuf rpc: unknownMethod(HelloRequest) returns (HelloResponse);
     */
    unknownMethod(input: HelloRequest, options?: RpcOptions): UnaryCall<HelloRequest, HelloResponse>;
}
/**
 * @generated from protobuf service ErrorRpc
 */
export class ErrorRpcClient implements IErrorRpcClient, ServiceInfo {
    typeName = ErrorRpc.typeName;
    methods = ErrorRpc.methods;
    options = ErrorRpc.options;
    constructor(private readonly _transport: RpcTransport) {
    }
    /**
     * @generated from protobuf rpc: timeout(HelloRequest) returns (HelloResponse);
     */
    timeout(input: HelloRequest, options?: RpcOptions): UnaryCall<HelloRequest, HelloResponse> {
        const method = this.methods[0], opt = this._transport.mergeOptions(options);
        return stackIntercept<HelloRequest, HelloResponse>("unary", this._transport, method, opt, input);
    }
    /**
     * @generated from protobuf rpc: serverError(HelloRequest) returns (HelloResponse);
     */
    serverError(input: HelloRequest, options?: RpcOptions): UnaryCall<HelloRequest, HelloResponse> {
        const method = this.methods[1], opt = this._transport.mergeOptions(options);
        return stackIntercept<HelloRequest, HelloResponse>("unary", this._transport, method, opt, input);
    }
    /**
     * @generated from protobuf rpc: unknownMethod(HelloRequest) returns (HelloResponse);
     */
    unknownMethod(input: HelloRequest, options?: RpcOptions): UnaryCall<HelloRequest, HelloResponse> {
        const method = this.methods[2], opt = this._transport.mergeOptions(options);
        return stackIntercept<HelloRequest, HelloResponse>("unary", this._transport, method, opt, input);
    }
}