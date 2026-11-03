const paths = {
  flame: <><path d="M13 3c1 5-4 5-2 9 1-1 2-2 2-4 4 3 6 6 5 9a7 7 0 0 1-13-3c0-4 5-7 8-11Z" /><path d="M12 14c-3 3-3 5 0 7 3-2 3-4 0-7Z" /></>,
  activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  layers: <path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" />,
  tool: <path d="m14 6 4 4 3-3a6 6 0 0 1-8 7l-6 6a2 2 0 0 1-3-3l6-6a6 6 0 0 1 7-8l-3 3Z" />,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  terminal: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m7 9 3 3-3 3m6 0h4" /></>,
  shield: <><path d="m12 3 8 3v6c0 4-5 8-8 9-3-1-8-5-8-9V6l8-3Z" /><path d="m8 12 3 3 5-6" /></>,
};

export function Icon({ name }: { name: keyof typeof paths }) {
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}
