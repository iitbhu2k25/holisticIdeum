"use client";

import Link from 'next/link';
import {
  Activity, ArrowRight, Columns2, Database, Droplets, Factory, Layers, MapPin, MousePointerClick, Save, Waves,
} from 'lucide-react';
import { DATASET_CATEGORIES } from '../../shared/config';

const PILLARS: Record<string, { text: string; href: string }> = {
  aviral: { text: 'River flow, rainfall, groundwater recharge and terrain.', href: '/aviral-ganga/river-discharge-assessment' },
  nirmal: { text: 'Water quality, sewage load, STPs and industrial discharge.', href: '/nirmal-ganga/river-water-quality' },
  jan: { text: 'Population, gram panchayats and community participation.', href: '/jan-ganga/social-attachment-and-impact' },
  arth: { text: 'Agriculture, irrigation, tourism and river economy.', href: '/arth-ganga/river-based-economic-linkages' },
  gyan: { text: 'Baseline data, remote sensing, models and monitoring.', href: '/gyan-ganga/river-vulnerability-and-interventions' },
  jeevant: { text: 'Wetlands, riparian buffers and biodiversity.', href: '/jeevant-ganga/biodiversity-ecological-indicators' },
};

const DATA_LINKS = [
  { title: 'River stretches', icon: Waves, href: '/nirmal-ganga/river-stretches-information', image: '/river1.png' },
  { title: 'Water quality', icon: Droplets, href: '/nirmal-ganga/river-water-quality', image: '/image_11.jpeg' },
  { title: 'Discharge', icon: Activity, href: '/aviral-ganga/river-discharge-assessment', image: '/river7.png' },
  { title: 'Sewage load', icon: MapPin, href: '/nirmal-ganga/sewage-load-estimation', image: '/river2.png' },
  { title: 'STP status', icon: Factory, href: '/nirmal-ganga/stp-status-and-sewage-gap', image: '/image_9.jpeg' },
  { title: 'Dashboard', icon: Database, href: '/dashboard', image: '/dash.png' },
];

const STEPS = [
  { icon: MousePointerClick, title: 'Pick your area', text: 'Select zones, or draw a polygon on the map.' },
  { icon: Layers, title: 'Add data', text: 'Choose criteria and uploaded datasets; everything is clipped to your area.' },
  { icon: Save, title: 'Compare & save', text: 'Compare side by side in Split view. Sign in to keep your sessions.' },
];

export default function HomePage() {
  return (
    <div className="bg-white">
      {/* ── hero ── */}
      <section className="relative isolate overflow-hidden">
        <img src="/river3.png" alt="" className="absolute inset-0 -z-10 h-full w-full object-cover" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-slate-950/90 via-slate-900/70 to-slate-900/20" />
        <div className="mx-auto flex min-h-[520px] max-w-6xl flex-col justify-center px-6 py-20">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-sky-300">Smart Laboratory on Clean Rivers</p>
          <h1 className="max-w-2xl text-4xl font-extrabold leading-tight text-white md:text-6xl">
            Holistic River Management
          </h1>
          <p className="mt-4 max-w-xl text-lg text-slate-200">
            One map for river health: flow, water quality, people, economy, knowledge and ecology, analysed zone by zone.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/holistic" className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-5 py-3 font-semibold text-white shadow-lg hover:bg-sky-400">
              Open Holistic module <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/split" className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-5 py-3 font-semibold text-white ring-1 ring-white/30 backdrop-blur hover:bg-white/20">
              <Columns2 className="h-4 w-4" /> Split view
            </Link>
          </div>
        </div>
      </section>

      {/* ── six pillars ── */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="mb-8 max-w-2xl">
          <h2 className="text-2xl font-bold text-slate-900 md:text-3xl">Six pillars, one river</h2>
          <p className="mt-2 text-slate-600">Each pillar has its own criteria and data. Open one to explore, or bring them together in the Holistic module.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {DATASET_CATEGORIES.map((c) => (
            <Link
              key={c.key}
              href={PILLARS[c.key].href}
              className="group flex items-start gap-4 rounded-2xl border border-slate-200 p-5 transition hover:-translate-y-0.5 hover:border-transparent hover:shadow-lg"
            >
              <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white" style={{ background: c.color }}>
                {c.stageIndex + 1}
              </span>
              <span>
                <span className="flex items-center gap-1 font-semibold text-slate-900">
                  {c.label}
                  <ArrowRight className="h-4 w-4 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" style={{ color: c.color }} />
                </span>
                <span className="mt-1 block text-sm text-slate-600">{PILLARS[c.key].text}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* ── how it works ── */}
      <section className="bg-slate-50">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="mb-8 text-2xl font-bold text-slate-900 md:text-3xl">How it works</h2>
          <ol className="grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-100 text-sky-700"><s.icon className="h-4 w-4" /></span>
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Step {i + 1}</span>
                </div>
                <p className="font-semibold text-slate-900">{s.title}</p>
                <p className="mt-1 text-sm text-slate-600">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── quick data links ── */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-2xl font-bold text-slate-900 md:text-3xl">Explore the data</h2>
          <Link href="/data-access" className="inline-flex items-center gap-1 text-sm font-semibold text-sky-700 hover:text-sky-900">
            All data access <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {DATA_LINKS.map((d) => (
            <Link key={d.title} href={d.href} className="group overflow-hidden rounded-2xl border border-slate-200 transition hover:shadow-lg">
              <div className="h-24 overflow-hidden bg-slate-100">
                <img src={d.image} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
              </div>
              <div className="flex items-center gap-2 p-3">
                <d.icon className="h-4 w-4 shrink-0 text-sky-700" />
                <span className="text-sm font-semibold text-slate-800">{d.title}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
