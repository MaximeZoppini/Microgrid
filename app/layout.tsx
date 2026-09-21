import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Microgrid × Jev',
  description: 'Simulation de microgrid insulaire avec IA décisionnelle',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="antialiased">{children}</body>
    </html>
  );
}
