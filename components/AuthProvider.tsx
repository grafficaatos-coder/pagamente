'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabaseBrowserClient, supabaseConfigured } from '@/lib/supabase';

const DEMO_USER = { id: 'demo-user', email: 'admin@sistema-cobranca.demo' } as User;

export type SignUpPayload = {
  contactName: string;
  companyName: string;
  legalName: string;
  documentType: 'cnpj' | 'cpf';
  document: string;
  phone: string;
  email: string;
  password: string;
  city: string;
  state: string;
  segment: string;
};

type AuthContextValue = {
  mode: 'supabase' | 'demo';
  user: User | null;
  loading: boolean;
  recoveryMode: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (payload: SignUpPayload) => Promise<string>;
  resendConfirmation: (email: string) => Promise<string>;
  resetPassword: (email: string) => Promise<string>;
  updatePassword: (password: string) => Promise<string>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function appOrigin() {
  if (typeof window !== 'undefined') return window.location.origin;
  return 'https://jpsistemadecobranca.com.br';
}

function appEntryUrl() {
  return appOrigin().replace(/\/$/,'') + '/sistema';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(supabaseConfigured ? null : DEMO_USER);
  const [loading, setLoading] = useState(supabaseConfigured);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const supabase = getSupabaseBrowserClient();

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (active) {
        setUser(data.user ?? null);
        setLoading(false);
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
      setUser(session?.user ?? null);
      setLoading(false);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  const value = useMemo<AuthContextValue>(() => ({
    mode: supabase ? 'supabase' : 'demo',
    user,
    loading,
    recoveryMode,
    async signIn(email, password) {
      if (!supabase) return;
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signUp(payload) {
      if (!supabase) return 'Modo demonstração ativo.';
      const { data, error } = await supabase.auth.signUp({
        email: payload.email,
        password: payload.password,
        options: {
          emailRedirectTo: appEntryUrl(),
          data: {
            display_name: payload.contactName,
            contact_name: payload.contactName,
            company_name: payload.companyName,
            legal_name: payload.legalName,
            document_type: payload.documentType,
            document: payload.document,
            phone: payload.phone,
            city: payload.city,
            state: payload.state,
            segment: payload.segment,
          },
        },
      });
      if (error) throw error;
      return data.session
        ? 'Conta criada e sessão iniciada.'
        : 'Cadastro realizado. Confirme seu e-mail para entrar.';
    },
    async resendConfirmation(email) {
      if (!supabase) return 'Modo demonstração ativo.';
      if (!email) throw new Error('Informe o e-mail da conta.');
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: appEntryUrl() },
      });
      if (error) throw error;
      return 'Novo e-mail de confirmação enviado. Use o link mais recente.';
    },
    async resetPassword(email) {
      if (!supabase) return 'Modo demonstração ativo.';
      if (!email) throw new Error('Informe seu e-mail para redefinir a senha.');
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: appEntryUrl(),
      });
      if (error) throw error;
      return 'Enviamos um link de recuperação para o seu e-mail.';
    },
    async updatePassword(password) {
      if (!supabase) return 'Modo demonstração ativo.';
      if (password.length < 8) throw new Error('Use uma senha com pelo menos 8 caracteres.');
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setRecoveryMode(false);
      return 'Senha atualizada com sucesso.';
    },
    async signOut() {
      if (supabase) await supabase.auth.signOut();
      setRecoveryMode(false);
    },
  }), [supabase, user, loading, recoveryMode]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth precisa estar dentro de AuthProvider');
  return context;
}
