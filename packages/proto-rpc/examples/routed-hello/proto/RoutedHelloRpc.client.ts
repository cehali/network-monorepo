// @generated by protobuf-ts 2.6.0 with parameter server_generic,generate_dependencies
// @generated from protobuf file "RoutedHelloRpc.proto" (syntax proto3)
// tslint:disable
import type { RpcTransport } from "@protobuf-ts/runtime-rpc";
import type { ServiceInfo } from "@protobuf-ts/runtime-rpc";
import { RoutedHelloRpc } from "./RoutedHelloRpc";
import { stackIntercept } from "@protobuf-ts/runtime-rpc";
import type { RoutedHelloResponse } from "./RoutedHelloRpc";
import type { RoutedHelloRequest } from "./RoutedHelloRpc";
import type { UnaryCall } from "@protobuf-ts/runtime-rpc";
import type { RpcOptions } from "@protobuf-ts/runtime-rpc";
/**
 * @generated from protobuf service RoutedHelloRpc
 */
export interface IRoutedHelloRpcClient {
    /**
     * @generated from protobuf rpc: sayHello(RoutedHelloRequest) returns (RoutedHelloResponse);
     */
    sayHello(input: RoutedHelloRequest, options?: RpcOptions): UnaryCall<RoutedHelloRequest, RoutedHelloResponse>;
}
/**
 * @generated from protobuf service RoutedHelloRpc
 */
export class RoutedHelloRpcClient implements IRoutedHelloRpcClient, ServiceInfo {
    typeName = RoutedHelloRpc.typeName;
    methods = RoutedHelloRpc.methods;
    options = RoutedHelloRpc.options;
    constructor(private readonly _transport: RpcTransport) {
    }
    /**
     * @generated from protobuf rpc: sayHello(RoutedHelloRequest) returns (RoutedHelloResponse);
     */
    sayHello(input: RoutedHelloRequest, options?: RpcOptions): UnaryCall<RoutedHelloRequest, RoutedHelloResponse> {
        const method = this.methods[0], opt = this._transport.mergeOptions(options);
        return stackIntercept<RoutedHelloRequest, RoutedHelloResponse>("unary", this._transport, method, opt, input);
    }
}