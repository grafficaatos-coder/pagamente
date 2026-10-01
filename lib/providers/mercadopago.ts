import {PaymentProvider,ChargeRequest,ChargeResult} from './types';
export class MercadoPagoProvider implements PaymentProvider{
 private token=process.env.MERCADOPAGO_ACCESS_TOKEN;
 async createCharge(_req:ChargeRequest):Promise<ChargeResult>{if(!this.token)throw new Error('MERCADOPAGO_ACCESS_TOKEN não configurado');throw new Error('Adapter Mercado Pago preparado, finalize o payload conforme a conta/produção antes de ativar.')}
 async cancelCharge(_providerId:string):Promise<void>{throw new Error('Mercado Pago não configurado')}
 async getChargeStatus(_providerId:string):Promise<ChargeResult['status']>{throw new Error('Mercado Pago não configurado')}
 async processWebhook(_payload:unknown,_headers:Headers):Promise<{providerId?:string;status?:ChargeResult['status']}>{return {}}
}
