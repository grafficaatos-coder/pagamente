export const clients=[
 {id:'cli_1',name:'João da Silva',doc:'123.456.789-00',email:'joao@email.com',whatsapp:'(41) 99999-0101',active:true},
 {id:'cli_2',name:'Empresa ABC Ltda.',doc:'12.345.678/0001-90',email:'financeiro@abc.com',whatsapp:'(41) 99999-0202',active:true},
 {id:'cli_3',name:'Maria Souza',doc:'987.654.321-00',email:'maria@email.com',whatsapp:'(41) 99999-0303',active:true}
];
export const charges=[
 {id:'c1',client:'João da Silva',description:'Mensalidade Setembro',amount:85000,due:'10/10/2026',status:'pending',provider:'Mercado Pago'},
 {id:'c2',client:'Empresa ABC Ltda.',description:'Contrato mensal',amount:250000,due:'05/10/2026',status:'overdue',provider:'Itaú'},
 {id:'c3',client:'Maria Souza',description:'Serviço avulso',amount:120000,due:'22/09/2026',status:'paid',provider:'Bradesco'}
];
export const brl=(c:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(c/100);
