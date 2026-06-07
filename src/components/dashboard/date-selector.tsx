"use client";

interface DateSelectorProps {
  start: string;
  end: string;
  min: string;
  max: string;
  onChange: (next: { start: string; end: string }) => void;
}

// Format YYYY-MM-DD valide (l'input date natif émet cette shape ou "")
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function DateSelector({ start, end, min, max, onChange }: DateSelectorProps) {
  // L'input type="date" peut émettre des valeurs vides ou partielles pendant
  // que l'utilisateur tape (le navigateur réinitialise temporairement la
  // valeur). On ne propage le changement que pour une date ISO complète,
  // sinon ça casse les useMemo en aval qui parsent la string en Date.
  const handleStart = (v: string) => {
    if (!ISO_DATE_RE.test(v)) return;
    if (v < min || v > end) return;
    onChange({ start: v, end });
  };
  const handleEnd = (v: string) => {
    if (!ISO_DATE_RE.test(v)) return;
    if (v < start || v > max) return;
    onChange({ start, end: v });
  };

  return (
    <div className="card-elev px-3 py-2 flex flex-wrap items-center gap-3 text-sm">
      <span className="muted text-xs uppercase tracking-wider">Période</span>
      <label className="flex items-center gap-2">
        <span className="muted">Du</span>
        <input
          type="date"
          value={start}
          min={min}
          max={end}
          onChange={(e) => handleStart(e.target.value)}
          className="bg-transparent border border-[color:var(--border)] rounded px-2 py-1 text-xs"
        />
      </label>
      <label className="flex items-center gap-2">
        <span className="muted">Au</span>
        <input
          type="date"
          value={end}
          min={start}
          max={max}
          onChange={(e) => handleEnd(e.target.value)}
          className="bg-transparent border border-[color:var(--border)] rounded px-2 py-1 text-xs"
        />
      </label>
    </div>
  );
}
