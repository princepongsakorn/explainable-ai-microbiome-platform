import "@/styles/globals.css";

import type { AppProps } from "next/app";
import { FC, useEffect, Fragment } from "react";

export default function App({ Component, pageProps }: AppProps) {
  const Layout = (Component as any).Layout || Fragment;
  const LayoutWrapper: FC<{ pageProps: any }> = (props) => {
    return Layout === Fragment ? <>{props.children}</> : <Layout {...props} />;
  };

  return (
    <LayoutWrapper pageProps={pageProps}>
      <Component {...pageProps} />
    </LayoutWrapper>
  );
}
