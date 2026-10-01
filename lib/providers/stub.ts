import {PaymentProvider,ChargeRequest,ChargeResult} from './types';
export class BankStubProvider implements PaymentProvider{
 constructor(private bank:string){}
 async createCharge(_req:ChargeRequest):Promise<ChargeResult>{throw new Error(`${this.bank}: credenciais/convênio bancário ainda não configurados`)}
 async cancelCharge(_providerId:string):Promise<void>{throw new Error(`${this.bank}: não configurado`)}
 async getChargeStatus(_providerId:string):Promise<ChargeResult['status']>{throw new Error(`${this.bank}: não configurado`)}
 async processWebhook(_payload:unknown,_headers:Headers):Promise<{providerId?:string;status?:ChargeResult['status']}>{return {}}
}
