import { Html, Head, Main, NextScript } from "next/document";

export const metadata = {
  title: 'Page Title',
  description: 'Page Description',
}

export default function Document() {
  return (
    <Html lang="en">
      <Head />
      <body className="antialiased">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
