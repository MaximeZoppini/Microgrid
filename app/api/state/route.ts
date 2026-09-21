import { NextResponse } from 'next/server';
import { getState, tick } from '@/lib/simulation';

export async function GET() {
  return NextResponse.json(getState());
}

export async function POST() {
  return NextResponse.json(tick());
}
