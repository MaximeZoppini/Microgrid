import { NextResponse } from 'next/server';
import { getState, tick } from '@/lib/simulation';

/** GET /api/state — current simulation state */
export async function GET() {
  return NextResponse.json(getState());
}

/** POST /api/state — advance one tick */
export async function POST() {
  const newState = tick();
  return NextResponse.json(newState);
}
