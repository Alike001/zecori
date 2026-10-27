declare module '*.mdx' {
  import type { JSX } from 'react';
  import type { MDXProps } from 'mdx/types';

  export const meta: {
    slug: string;
    title: string;
    eyebrow: string;
    summary: string;
    featureIds: string[];
  };
  export default function MDXContent(props: MDXProps): JSX.Element;
}
