import {
  User, Briefcase, PartyPopper, Hammer, Wallet, GraduationCap, Folder,
} from "lucide-react";

export const CATEGORY_META = {
  pessoal:    { label: "Pessoal",    icon: User,           tint: "oklch(0.96 0.025 285)", accent: "oklch(0.55 0.22 285)" },
  trabalho:   { label: "Trabalho",   icon: Briefcase,      tint: "oklch(0.96 0.025 240)", accent: "oklch(0.5 0.18 240)" },
  evento:     { label: "Evento",     icon: PartyPopper,    tint: "oklch(0.96 0.04 25)",   accent: "oklch(0.6 0.18 25)" },
  construcao: { label: "Construção", icon: Hammer,         tint: "oklch(0.96 0.04 75)",   accent: "oklch(0.55 0.16 75)" },
  financeiro: { label: "Financeiro", icon: Wallet,         tint: "oklch(0.96 0.04 155)",  accent: "oklch(0.5 0.14 155)" },
  estudos:    { label: "Estudos",    icon: GraduationCap,  tint: "oklch(0.96 0.04 195)",  accent: "oklch(0.5 0.14 195)" },
  outros:     { label: "Outros",     icon: Folder,         tint: "oklch(0.95 0.005 250)", accent: "oklch(0.45 0.015 260)" },
} as const;

export const STATUS_META = {
  planejando:    { label: "Planejando",    tint: "oklch(0.95 0.012 250)", accent: "oklch(0.45 0.04 260)" },
  em_andamento:  { label: "Em andamento",  tint: "oklch(0.95 0.04 240)",  accent: "oklch(0.5 0.16 240)" },
  pausado:       { label: "Pausado",       tint: "oklch(0.95 0.04 75)",   accent: "oklch(0.5 0.14 75)" },
  finalizado:    { label: "Finalizado",    tint: "oklch(0.95 0.04 155)",  accent: "oklch(0.45 0.13 155)" },
} as const;

export const PRIORITY_META = {
  baixa:  { label: "Baixa",  tint: "oklch(0.95 0.012 250)", accent: "oklch(0.5 0.04 260)" },
  media:  { label: "Média",  tint: "oklch(0.95 0.04 240)",  accent: "oklch(0.5 0.14 240)" },
  alta:   { label: "Alta",   tint: "oklch(0.95 0.05 25)",   accent: "oklch(0.55 0.18 25)" },
} as const;
