import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

function key(){
  const secret=process.env.MERCADOPAGO_TOKEN_ENCRYPTION_KEY;
  if(!secret) throw new Error('MERCADOPAGO_TOKEN_ENCRYPTION_KEY não configurada.');
  return createHash('sha256').update(secret).digest();
}

export function encryptSecret(value:string){
  const iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key(),iv);
  const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  const tag=cipher.getAuthTag();
  return ['v1',iv.toString('base64url'),tag.toString('base64url'),encrypted.toString('base64url')].join('.');
}

export function decryptSecret(value:string){
  const [version,iv,tag,ciphertext]=value.split('.');
  if(version!=='v1'||!iv||!tag||!ciphertext) throw new Error('Credencial criptografada inválida.');
  const decipher=createDecipheriv('aes-256-gcm',key(),Buffer.from(iv,'base64url'));
  decipher.setAuthTag(Buffer.from(tag,'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext,'base64url')),
    decipher.final()
  ]).toString('utf8');
}
