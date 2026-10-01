export type ProviderKey = 'mercado_pago' | 'bradesco' | 'itau' | 'caixa' | 'mock';
export type ChargeStatus = 'draft' | 'pending' | 'paid' | 'overdue' | 'cancelled' | 'failed';
export type TransferStatus = 'pending' | 'completed' | 'failed' | 'cancelled';

export type Organization = {
  id: string;
  name: string;
  status: 'trialing' | 'active' | 'past_due' | 'suspended' | 'cancelled';
};

export type Wallet = {
  id: string;
  organizationId: string;
  accountNumber: string;
  pixKey: string;
  balanceCents: number;
};

export type Client = {
  id: string;
  name: string;
  document: string;
  email: string;
  whatsapp: string;
  phone?: string;
  address?: string;
  notes?: string;
  active: boolean;
  createdAt: string;
};

export type Charge = {
  id: string;
  clientId: string;
  description: string;
  amountCents: number;
  dueDate: string;
  status: ChargeStatus;
  provider: ProviderKey;
  sendEmail: boolean;
  sendWhatsapp: boolean;
  recurringRuleId?: string;
  occurrenceKey?: string;
  digitableLine?: string;
  pixCode?: string;
  boletoUrl?: string;
  createdAt: string;
  paidAt?: string;
};

export type RecurringRule = {
  id: string;
  clientId: string;
  description: string;
  amountCents: number;
  frequency: 'biweekly' | 'monthly' | 'quarterly' | 'annual';
  generationDay: number;
  dueDay: number;
  provider: ProviderKey;
  sendEmail: boolean;
  sendWhatsapp: boolean;
  status: 'active' | 'paused' | 'cancelled';
  createdAt: string;
};

export type Transfer = {
  id: string;
  senderOrganizationId: string;
  recipientOrganizationId?: string;
  recipientName: string;
  destinationKey: string;
  description: string;
  amountCents: number;
  feeCents: number;
  status: TransferStatus;
  createdAt: string;
  completedAt?: string;
};

export type Transaction = {
  id: string;
  type: 'charge' | 'transfer' | 'adjustment';
  direction: 'credit' | 'debit';
  description: string;
  counterpart: string;
  amountCents: number;
  createdAt: string;
  referenceId?: string;
};

export type Plan = {
  id: string;
  code: string;
  name: string;
  monthlyPriceCents: number;
  feeBps: number;
};

export type Subscription = {
  id: string;
  plan?: Plan;
  status: 'trialing' | 'active' | 'past_due' | 'suspended' | 'cancelled';
  trialEndsAt?: string;
  currentPeriodEnd?: string;
};

export type AppState = {
  organization?: Organization;
  wallet?: Wallet;
  clients: Client[];
  charges: Charge[];
  recurring: RecurringRule[];
  transfers: Transfer[];
  transactions: Transaction[];
  subscription?: Subscription;
  isPlatformAdmin: boolean;
};

export const providerLabel: Record<ProviderKey, string> = {
  mercado_pago: 'Mercado Pago',
  bradesco: 'Bradesco',
  itau: 'Itaú',
  caixa: 'CAIXA',
  mock: 'Demonstração',
};
