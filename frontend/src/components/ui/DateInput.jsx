/* A date box that says what it is. Chrome on Android draws an empty date input
   as a blank field with no placeholder, so the old pair read as two broken
   controls either side of a dash. The label sits inside the box, where it
   can't be separated from it by wrapping. `inset` is sized to the label, so
   the date starts just past "To" rather than a "From"-width gap after it. */
export default function DateInput({ label, inset, value, onChange, min, max }) {
  return (
    <label className="relative block min-w-0">
      <span className="meta absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none">{label}</span>
      <input type="date" value={value} min={min || undefined} max={max || undefined}
        onChange={e => onChange(e.target.value)}
        className={`neu-input w-full ${inset} pr-1 py-1.5 text-[13px]`} />
    </label>
  )
}
