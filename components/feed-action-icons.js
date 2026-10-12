export function CommentIcon({ classes }) {
  return <svg className={classes.actionIcon} viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 5.5h15v10h-9l-4.5 3v-3H4.5v-10Z" /></svg>
}

export function OpenPuddleIcon({ classes }) {
  return <svg className={classes.actionIcon} viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18 18 6M9 6h9v9" /></svg>
}

export function SaveIcon({ saved, classes }) {
  return <svg className={`${classes.actionIcon} ${saved ? classes.actionIconFilled : ''}`} viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.6c0 5-8.8 10.4-8.8 10.4S3.2 13.6 3.2 8.6A4.6 4.6 0 0 1 12 6.7a4.6 4.6 0 0 1 8.8 1.9Z" /></svg>
}

export function ShareIcon({ classes }) {
  return <svg className={classes.actionIcon} viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" /></svg>
}
