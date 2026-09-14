import Image from "next/image";
import Link from "next/link";
import { ReactNode } from "react";

import { Logo } from "@/components/common/Logo";

function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <Logo />
      <span className="font-medium" translate="no">
        Explainable
      </span>
    </span>
  );
}

/**
 * The sign-in and sign-up frame: brand artwork beside the form on wide
 * screens, the form alone on narrow ones.
 */
export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[3fr_2fr]">
      <div className="relative hidden overflow-hidden bg-muted lg:block">
        <Image
          src="/assets/login-bg.png"
          alt=""
          layout="fill"
          objectFit="cover"
          sizes="60vw"
          priority
        />
        <div className="absolute left-6 top-6">
          <Wordmark />
        </div>
      </div>

      <main className="flex items-center justify-center px-6 py-12 sm:px-10">
        <div className="flex w-full max-w-sm flex-col gap-8">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="mb-4 lg:hidden">
              <Wordmark />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight [text-wrap:balance]">
              {title}
            </h1>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          {children}
          <p className="border-t pt-6 text-center text-sm text-muted-foreground">
            {footer}
          </p>
        </div>
      </main>
    </div>
  );
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} passHref>
      <a className="rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {children}
      </a>
    </Link>
  );
}
