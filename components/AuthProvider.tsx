'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabaseBrowserClient, supabaseConfigured } from '@/lib/supabase';

const DEMO_USER = { id: 'demo-user', email: 'admin@sistema-cobranca.demo' } as User;

type AuthContextValue = {
  mode: 'supabase' | 'demo';
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, company: string, email: string, password: string) => Promise<string>;
  resendConfirmation: (email: string) => Promise<string>;
  resetPassword: (email: string) => Promise<string>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function appOrigin() {
  if (typeof window !== 'undefined') return window.location.origin;
  return 'https://pagamente.vercel.app';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(supabaseConfigured ? null : DEMO_USER);
  const [loading, setLoading] = useState(supabaseConfigured);
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
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
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
    async signIn(email, password) {
      if (!supabase) return;
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signUp(name, company, email, password) {
      if (!supabase) return 'Modo demonstração ativo.';
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: name, company_name: company },
          emailRedirectTo: appOrigin(),
        },
      });
      if (error) throw error;
      return data.session
        ? 'Conta criada e sessão iniciada.'
        : 'Conta criada. Confirme o e-mail para entrar.';
    },
    async resendConfirmation(email) {
      if (!supabase) return 'Modo demonstração ativo.';
      if (!email) throw new Error('Informe o e-mail da conta.');
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: appOrigin() },
      });
      if (error) throw error;
      return 'Novo e-mail de confirmação enviado. Use o link mais recente.';
    },
    async resetPassword(email) {
      if (!supabase) return 'Modo demonstração ativo.';
      if (!email) throw new Error('Informe seu e-mail para redefinir a senha.');
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: appOrigin(),
      });
      if (error) throw error;
      return 'Enviamos um link de recuperação para o seu e-mail.';
    },
    async signOut() {
      if (supabase) await supabase.auth.signOut();
    },
  }), [supabase, user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth precisa estar dentro de AuthProvider');
  return context;
}
