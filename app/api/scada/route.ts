import { NextRequest, NextResponse } from 'next/server';
import { injectScadaFault, restoreScada } from '@/lib/scada';
import { getState } from '@/lib/simulation';

/** POST /api/scada — inject or restore SCADA communication fault */
export async function POST(req: NextRequest) {
  const body = await req.json() as { action: 'fault' | 'restore' };

  if (body.action === 'fault') {
    injectScadaFault();
    return NextResponse.json({ ok: true, message: 'Coupure SCADA injectée — mode autonome dans 3 ticks', state: getState() });
  }

  restoreScada();
  return NextResponse.json({ ok: true, message: 'Lien SCADA restauré — retour en mode distant', state: getState() });
}
