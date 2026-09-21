import { NextRequest, NextResponse } from 'next/server';
import { injectFault, clearFaults, getState } from '@/lib/simulation';

/** POST /api/fault — inject or clear a fault */
export async function POST(req: NextRequest) {
  const body = await req.json() as { action: 'inject' | 'clear'; target?: string; severity?: 'partial' | 'total' };

  if (body.action === 'clear') {
    clearFaults();
    return NextResponse.json({ ok: true, message: 'Toutes les pannes effacées', state: getState() });
  }

  if (!body.target) {
    return NextResponse.json({ ok: false, message: 'target required' }, { status: 400 });
  }

  const message = injectFault(body.target, body.severity ?? 'total');
  return NextResponse.json({ ok: true, message, state: getState() });
}
