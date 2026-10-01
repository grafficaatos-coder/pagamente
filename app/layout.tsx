import './globals.css';
import { AuthProvider } from '@/components/AuthProvider';
import { DataProvider } from '@/components/DataProvider';
import AppGate from '@/components/AppGate';

export const metadata = {
  title: 'Pagamente',
  description: 'Gestão de cobranças, recebimentos e transferências empresariais',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR"><body><AuthProvider><DataProvider><AppGate>{children}</AppGate></DataProvider></AuthProvider></body></html>;
}
