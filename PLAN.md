# Microgrid × Jev — Plan d'implémentation

## Concept

Un simulateur de **microgrid insulaire** (île autonome : solaire, éolien, batterie, diesel, connexion réseau) où l'utilisateur déclenche des pannes et **Jev joue le rôle de l'incident commander** — la couche de décision que ton logiciel d'optimisation classique ne peut pas couvrir.

### Positionnement produit

Ton logiciel d'optimisation (MPC / LP) gère les **95% d'opérations normales** parfaitement.  
Jev gère les **5% d'exceptions critiques** + explique les décisions en langage naturel aux opérateurs.

| Situation | Ton algo | Jev |
|---|---|---|
| Opération normale optimisée | ✅ Imbattable | ❌ Inutile ici |
| Panne imprévue hors règles | ❌ Brittle | ✅ Raisonne |
| Priorisation multi-parties (hôpital vs industrie) | ❌ Hard-codé | ✅ Contextuel |
| Explication à l'opérateur | ❌ "LP dit X" | ✅ En français |
| Multi-panne simultanée (LP infaisable) | ❌ Pas de solution | ✅ Généralise |

---

## Architecture

```
Browser
├── MicrogridSVG.tsx     — île SVG animée avec flux d'énergie
├── ControlPanel.tsx     — boutons pannes + historique incidents
└── JevReasoning.tsx     — reasoning chain visuel

Next.js API
├── /api/simulate        — GET tick toutes les 2s (état du microgrid)
└── /api/event           — POST panne → Jev → décision → action

lib/
├── microgrid.ts         — moteur de simulation (state machine + physique simple)
├── jev-energy.ts        — client Jev pour décisions énergie
└── profiles.ts          — profils temporels solaire/vent/conso
```

---

## Le microgrid simulé

### Composants
| Élément | Paramètres |
|---|---|
| ☀️ Panneaux solaires | 0–80 kW, profil journalier + bruit + nuages |
| 💨 Éolienne | 0–40 kW, distribution Weibull |
| 🔋 Batterie | 100 kWh, SoC 0–100%, ±50 kW max |
| ⛽ Diesel | 60 kW, démarrage 30s, coût 0.18€/kWh |
| 🔌 Réseau national | ±100 kW, prix spot variable |
| 🏥 Hôpital | 20 kW — **non-délestable** |
| 🏘 Résidentiel | 30 kW — délestage partiel possible |
| 🏭 Industrie | 50 kW — délestage total possible |

### Métriques affichées en temps réel
- Balance P (kW) : production − consommation
- Fréquence réseau (Hz) — baisse sous 49.8 → alarme
- SoC batterie (%)
- Coût cumulé (€)
- CO₂ émis (g)
- Disponibilité réseau (%)

---

## Pannes déclenchables

| Panne | Difficulté algo classique |
|---|---|
| ☀️ Perte partielle solaire (−60%) | Simple si batterie ok |
| 💨 Panne éolienne totale | Simple |
| 🔋 Défaillance batterie (bloquée) | Moyen |
| 🔌 Perte réseau national → island mode | **Complexe : priorisation** |
| 🏭 Pic industriel soudain +30 kW | **Décision temps réel** |
| 🔥 Multi-panne (2 simultanées) | **Impossible à couvrir par règles** |

---

## Pipeline de décision Jev

### 1 appel `systemOne()` — 3 questions en parallèle

**State (description naturelle) :**
```
Microgrid insulaire, 14h30.
Production: Solaire 12 kW (PANNE partielle), Éolienne 28 kW.
Stockage: Batterie 34% SoC (34 kWh dispo), décharge max 50 kW.
Demande: Hôpital 20 kW (critique non-délestable), Résidentiel 28 kW,
         Industrie 50 kW (délestable). Total: 98 kW.
Balance: DÉFICIT -58 kW.
Réseau national: INDISPONIBLE (panne depuis 2min).
Diesel: disponible, arrêté (démarrage possible en 30s).
```

**Questions :**
```typescript
{
  critical: noul('Is grid stability at immediate risk? (under-frequency < 30s?)'),
  severity: score('How severe is the situation?', [
    'manageable — resources cover demand',
    'concerning — partial measures needed',
    'serious — backup or load shed required',
    'critical — total blackout imminent',
  ] as const),
  action: choice('What is the correct incident response?', {
    maintain_current:  'Resources sufficient, no action needed',
    discharge_battery: 'Discharge battery to cover deficit',
    activate_diesel:   'Start diesel generator to restore balance',
    shed_industrial:   'Cut industrial load (non-critical)',
    shed_residential:  'Partial residential shedding (last resort)',
    island_priority:   'Island mode: hospital + battery reserve only',
    alert_operator:    'Escalate to human operator',
  }),
}
```

### Reasoning chain affichée
```
⚡ SITUATION   Déficit −58 kW | Réseau perdu | Batterie 34%
🔴 CRITICITÉ   SÉRIEUX — sous-fréquence dans ~45s
📋 ANALYSE     Batterie: 40min autonomie à −58kW | Diesel: disponible
→ DÉCISION     Activer diesel + Délester industrie
💬 EXPLICATION "Réseau perdu avec batterie à 34% : diesel pour stabiliser,
               industrie délestée, hôpital et résidentiel maintenus.
               Batterie conservée en réserve court terme."
⏱ Décision en 387ms
```

---

## Interface visuelle

### Île SVG animée
- Vue du dessus : mer, île, composants positionnés
- **Flux d'énergie animés** : lignes avec pulses colorés
  - 🟢 Vert = renouvelable
  - 🟠 Orange = diesel
  - 🔵 Bleu = réseau
  - 🔴 Rouge = délestage actif
- **État composants** : icône + couleur (vert/orange/rouge/clignotant si panne)
- **Animation panne** : flash rouge + ligne sectionnée visuellement

### Panneau de contrôle
- Boutons de pannes avec descriptions
- Historique des incidents et décisions
- Métriques live (coût, CO₂, disponibilité)

---

## Fichiers à créer

### [NEW] `lib/microgrid.ts`
State machine du microgrid : tick de simulation, physique simplifiée, gestion des pannes actives, profils temporels.

### [NEW] `lib/jev-energy.ts`
Buildeur de description naturelle du microgrid + appel TypeSafe + parsing de la réponse.

### [NEW] `data/profiles.ts`
Profils temporels : irradiance solaire (courbe sin + bruit), vent (Weibull), demande (courbe type résidentiel/industriel), prix réseau.

### [NEW] `app/api/simulate/route.ts`
GET → retourne l'état courant du microgrid (JSON). Appelé toutes les 2s par le frontend.

### [NEW] `app/api/event/route.ts`
POST `{ faultType, params }` → met à jour l'état, appelle Jev, retourne `{ newState, jevDecision, action }`. Applique l'action sur le state.

### [NEW] `app/page.tsx`
Layout principal : MicrogridSVG (gauche large) + ControlPanel (droite).

### [NEW] `components/MicrogridSVG.tsx`
SVG ~600×500px de l'île avec composants et flux animés. Recoit le state via props et anime en conséquence.

### [NEW] `components/ControlPanel.tsx`
Boutons pannes, métriques live, historique incidents.

### [NEW] `components/JevReasoning.tsx`
Carte reasoning chain : criticité + severity + action choisie + explication Jev.

---

## Déroulé de démo (3 min)

1. **(30s) Normal** : microgrid tourne, flux verts animés, tout va bien
2. **(30s) Panne simple** : perte réseau → Jev décide en 400ms → action visible
3. **(1min) Panne sérieuse** : batterie faible + pic industriel → Jev déleste l'industrie, protège l'hôpital, explique
4. **(1min) Multi-panne** : réseau + éolienne + demande pic → Jev fait des choix impossibles pour un algo classique → la valeur est évidente
5. **Accroche** : *"Votre logiciel d'optimisation aurait planté ici — Jev a géré."*

---

## Open questions

1. **Réalisme simulation** : balance P/Q simplifiée ou profils réels fournis par vous ?
2. **Langue Jev** : français (lisible en démo) ou anglais (prompts plus précis) ?
3. **Scénarios fixes** : pannes scriptées pour la démo (fiable) ou tout dynamique ?
4. **Intégration vraie** : standalone ou branchement sur une API de votre logiciel ?
