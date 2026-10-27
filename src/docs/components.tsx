import type { AnchorHTMLAttributes, ReactNode } from 'react';
import type { MDXComponents } from 'mdx/types.js';

export function DocNotice({ title, tone = 'note', children }: { title: string; tone?: 'note' | 'warning' | 'safe'; children: ReactNode }) {
  return <aside className={`doc-notice doc-notice-${tone}`}><strong>{title}</strong><div>{children}</div></aside>;
}

function ExternalAwareLink(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const external = typeof props.href === 'string' && /^https?:\/\//.test(props.href);
  return <a {...props} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}/>;
}

export const MDX_COMPONENTS: MDXComponents = {
  a: ExternalAwareLink,
  DocNotice,
};
