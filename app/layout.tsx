import './globals.css';
import { AuthProvider } from '@/components/AuthProvider';
import AppGate from '@/components/AppGate';

export const metadata = {
  title: 'Pagamente',
  description: 'Gestão de cobranças e recebimentos empresariais',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR"><body><AuthProvider><AppGate>{children}</AppGate></AuthProvider></body></html>;
}
