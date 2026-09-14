import React, { FC, useEffect, useState } from "react";
import Link from "next/link";
import { jwtDecode } from "jwt-decode";

import { NavSection } from "@/components/common/Layout/Layout";
import { getToken } from "@/pages/api/httpClient";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface TopbarProps {
  section?: NavSection;
  currentPage: string;
}

function readUsername(): string | undefined {
  const token = getToken();
  if (!token) return undefined;
  try {
    return jwtDecode<{ username?: string }>(token).username;
  } catch {
    return undefined;
  }
}

const Topbar: FC<TopbarProps> = ({ section, currentPage }) => {
  // Read after mount: the token lives in a cookie the server render cannot see.
  const [username, setUsername] = useState<string>();

  useEffect(() => {
    setUsername(readUsername());
  }, []);

  return (
    <header className="sticky top-0 z-30 grid h-[66px] grid-cols-[1fr_auto_1fr] items-center border-b bg-muted">
      <p className="truncate px-6 text-sm font-medium text-muted-foreground">
        {section?.name}
      </p>

      <nav aria-label={section ? `${section.name} pages` : undefined} className="h-full">
        <ul className="flex h-full gap-6">
          {section?.pages.map((page) => {
            const active = page.matches.includes(currentPage);
            return (
              <li key={page.href} className="h-full">
                <Link href={page.href} passHref>
                  <a
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex h-full items-center px-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      active && "text-foreground"
                    )}
                  >
                    {page.name}
                    {active && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-x-0 bottom-0 h-0.5 rounded-t-full bg-foreground"
                      />
                    )}
                  </a>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex min-w-0 items-center justify-end gap-2 px-3">
        <span className="truncate text-sm text-muted-foreground">{username}</span>
        <Avatar className="size-9">
          <AvatarFallback className="bg-primary text-sm font-semibold text-primary-foreground">
            {username ? username.charAt(0).toUpperCase() : "?"}
          </AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
};

export default Topbar;
