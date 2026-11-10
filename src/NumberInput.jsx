import React, { useEffect, useRef, useState } from 'react';

const display = value => value == null ? '' : String(value);

// Keep temporary text (including blank and trailing decimal zeroes) while the
// parent stores numbers for calculations. Actual external changes still sync.
export default function NumberInput({ value, onChange, onBlur, normalizeValue = Number, ...props }) {
  const [text, setText] = useState(() => display(value));
  const emitted = useRef(value);
  useEffect(() => {
    if (!Object.is(value, emitted.current)) setText(display(value));
    emitted.current = value;
  }, [value]);
  return <input {...props} type="number" inputMode={props.inputMode ?? 'decimal'} value={text}
    onChange={event => {
      const next = event.target.value;
      emitted.current = normalizeValue(next);
      setText(next);
      onChange?.(event);
    }}
    onBlur={event => {
      setText(display(value));
      onBlur?.(event);
    }}
  />;
}
