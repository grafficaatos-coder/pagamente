import {PaymentProvider,ChargeRequest,ChargeResult} from './types';
export class MockProvider implements PaymentProvider{
 async createCharge(req:ChargeRequest):Promise<ChargeResult>{return {providerId:`mock_${req.externalId}`,status:'pending',boletoUrl:`/demo/boleto/${req.externalId}`,barcode:'00190.00009 01234.567890 12345.678901 1 12340000000000',pixCode:`000201PAGAMENTE${req.externalId}`}}
 async cancelCharge(_providerId:string):Promise<void>{return}
 async getChargeStatus(_providerId:string):Promise<ChargeResult['status']>{return 'pending'}
 async processWebhook(_payload:unknown,_headers:Headers):Promise<{providerId?:string;status?:ChargeResult['status']}>{return {status:'pending'}}
}
