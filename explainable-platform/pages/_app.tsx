import "@/styles/globals.css";

import type { AppProps } from "next/app";
import { FC, Fragment } from "react";
import { UserProvider } from "@/contexts/auth/auth-context";
import { QueryClient, QueryClientProvider } from "react-query";
import { dialogError } from "@/lib/dialog";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      onError: async () => {
        await dialogError('Action Failed', 'An internal error occurred during your request. Please try again');
      },
    },
  },
});

export default function App({ Component, pageProps }: AppProps) {
  const Layout = (Component as any).Layout || Fragment;
  const LayoutWrapper: FC<{ pageProps: any }> = (props) => {
    return Layout === Fragment ? <>{props.children}</> : <Layout {...props} />;
  };

  return (
    <QueryClientProvider client={queryClient}>
      <UserProvider>
        <LayoutWrapper pageProps={pageProps}>
          <Component {...pageProps} />
        </LayoutWrapper>
      </UserProvider>
    </QueryClientProvider>
  );
}
