import "@/styles/globals.css";

import type { AppProps } from "next/app";
import Head from "next/head";
import { ComponentType } from "react";
import { UserProvider } from "@/contexts/auth/auth-context";
import { QueryClient, QueryClientProvider } from "react-query";
import { Toaster } from "@/components/ui/sonner";
import { notifyError } from "@/lib/notify";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      onError: () => {
        notifyError(
          "Couldn’t load data",
          "Check your connection, then try again."
        );
      },
    },
  },
});

/** What a page can declare about itself, next to its component. */
type Page = AppProps["Component"] & {
  Layout?: ComponentType<any>;
  title?: string;
};

export default function App({ Component, pageProps }: AppProps) {
  // Read the layout off the page rather than wrapping it in a component made
  // here: a component declared inside App is a new type on every render, and
  // React would remount the whole layout, and the page with it, each time.
  const { Layout, title } = Component as Page;
  const page = <Component {...pageProps} />;

  return (
    <QueryClientProvider client={queryClient}>
      <UserProvider>
        <Head>
          <title>{title ? `${title} · Explainable` : "Explainable"}</title>
        </Head>
        {Layout ? <Layout pageProps={pageProps}>{page}</Layout> : page}
        <Toaster />
      </UserProvider>
    </QueryClientProvider>
  );
}
