"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PALETA_TIPOS } from "./ui";

/**
 * Los dos gráficos del dashboard, en su propio archivo para cargarlos aparte.
 *
 * recharts es la dependencia más pesada del módulo. Separada, la página muestra
 * los números al instante y los gráficos llegan un momento después, en vez de
 * esperar a todo junto para pintar algo.
 */


const TOOLTIP = {
  contentStyle: { borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12, boxShadow: "0 10px 30px -12px rgba(15,23,42,0.25)" },
};

export function GraficoEstados({ datos }: { datos: { codigo: string; nombre: string; color: string; cantidad: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={datos} margin={{ top: 22, right: 8, left: -18, bottom: 0 }}>
        <defs>
          {datos.map((e) => (
            <linearGradient key={e.codigo} id={`g-${e.codigo}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={e.color} stopOpacity={1} />
              <stop offset="100%" stopColor={e.color} stopOpacity={0.55} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} stroke="#eef2f7" strokeDasharray="4 4" />
        <XAxis
          dataKey="nombre"
          tick={{ fontSize: 11, fill: "#64748b" }}
          tickLine={false}
          axisLine={{ stroke: "#e2e8f0" }}
          interval={0}
          tickFormatter={(v: string) => (v.length > 13 ? `${v.slice(0, 12)}…` : v)}
        />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
        <Tooltip cursor={{ fill: "rgba(79,174,178,0.06)" }} {...TOOLTIP} formatter={(v) => [v, "Tickets"]} />
        <Bar dataKey="cantidad" radius={[8, 8, 2, 2]} maxBarSize={46} animationDuration={600}>
          {datos.map((e) => (
            <Cell key={e.codigo} fill={`url(#g-${e.codigo})`} />
          ))}
          <LabelList dataKey="cantidad" position="top" style={{ fontSize: 11, fontWeight: 700, fill: "#334155" }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function GraficoTipos({ datos }: { datos: { nombre: string; cantidad: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={datos} dataKey="cantidad" nameKey="nombre" innerRadius="64%" outerRadius="94%" paddingAngle={3} cornerRadius={6} stroke="none" animationDuration={600}>
          {datos.map((t, i) => (
            <Cell key={t.nombre} fill={PALETA_TIPOS[i % PALETA_TIPOS.length]} />
          ))}
        </Pie>
        <Tooltip {...TOOLTIP} />
      </PieChart>
    </ResponsiveContainer>
  );
}
