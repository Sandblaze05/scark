import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head />
      <body className="antialiased selection:bg-purple-500/30 selection:text-white">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}