"use client";

import { FC } from "react";
import Link from "next/link";
import { ArrowRightStartOnRectangleIcon } from "@heroicons/react/24/outline";

import { NavSection } from "../Layout/Layout";
import { Logo } from "../Logo";
import { useUser } from "@/contexts/auth/auth-context";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface SidebarProps {
  sections: NavSection[];
  currentSection: string;
}

const Sidebar: FC<SidebarProps> = ({ sections, currentSection }) => {
  const { signOut } = useUser();

  // The links are icons only, so each carries its name for screen readers and
  // shows it on hover and focus for everyone else.
  return (
    <TooltipProvider delayDuration={200}>
      <nav
        aria-label="Main"
        className="fixed inset-y-0 left-0 z-40 flex w-[54px] flex-col items-center border-r bg-background py-5"
      >
        <Logo />
        <ul className="flex flex-1 flex-col gap-2 pt-20">
          {sections.map((section) => {
            const active = section.pathName === currentSection;
            const Icon = section.icon;
            return (
              <li key={section.pathName}>
                <Tooltip>
                  <Link href={section.pages[0].href} passHref>
                    <TooltipTrigger asChild>
                      <a
                        aria-label={section.name}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "relative flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          active && "bg-accent text-foreground"
                        )}
                      >
                        {active && (
                          <span
                            aria-hidden="true"
                            className="absolute inset-y-1.5 left-0 w-1 rounded-r-full bg-primary"
                          />
                        )}
                        <Icon aria-hidden="true" className="size-5" />
                      </a>
                    </TooltipTrigger>
                  </Link>
                  <TooltipContent side="right">{section.name}</TooltipContent>
                </Tooltip>
              </li>
            );
          })}
        </ul>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Sign out"
              className="text-muted-foreground"
              onClick={signOut}
            >
              <ArrowRightStartOnRectangleIcon aria-hidden="true" className="size-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Sign out</TooltipContent>
        </Tooltip>
      </nav>
    </TooltipProvider>
  );
};

export default Sidebar;
