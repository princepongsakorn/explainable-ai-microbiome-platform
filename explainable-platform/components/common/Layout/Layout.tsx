"use client";

import React, { FC } from "react";
import { useRouter } from "next/router";
import AuthenticationCheck from "@/hoc/AuthenticationCheck";
import Sidebar from "@/components/common/Sidebar";
import {
  ArrowUpTrayIcon,
  TableCellsIcon,
  CodeBracketIcon,
  BeakerIcon,
} from "@heroicons/react/24/outline";
import Topbar from "../Topbar";

interface Props {
  children: JSX.Element;
}

export interface NavPage {
  name: string;
  href: string;
  /** The last path segments that count as being on this page. */
  matches: string[];
}

export interface NavSection {
  icon: typeof ArrowUpTrayIcon;
  name: string;
  /** The first path segment every page of the section shares. */
  pathName: string;
  pages: NavPage[];
}

export const sections: NavSection[] = [
  {
    icon: ArrowUpTrayIcon,
    pathName: "upload",
    name: "Upload",
    pages: [{ name: "Upload File", href: "/upload/predict", matches: ["predict"] }],
  },
  {
    icon: TableCellsIcon,
    pathName: "prediction",
    name: "Predictions",
    pages: [
      {
        name: "Prediction List",
        href: "/prediction/prediction",
        matches: ["prediction", "local"],
      },
    ],
  },
  {
    icon: BeakerIcon,
    pathName: "experiments",
    name: "Experiments and Models",
    pages: [
      { name: "Experiments", href: "/experiments/experiments", matches: ["experiments"] },
      { name: "Models", href: "/experiments/models", matches: ["models"] },
    ],
  },
  {
    icon: CodeBracketIcon,
    pathName: "developer",
    name: "Developer",
    pages: [
      { name: "Personal Access Tokens", href: "/developer/token", matches: ["token"] },
      { name: "MLflow and Deployment", href: "/developer/mlflow", matches: ["mlflow"] },
    ],
  },
];

const Layout: FC<Props> = ({ children }: Props) => {
  const router = useRouter();
  const [, sectionPath, pagePath] = router.pathname.split("/");
  const section = sections.find((item) => item.pathName === sectionPath);

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-[70px] focus:top-3 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg"
      >
        Skip to content
      </a>
      <Sidebar sections={sections} currentSection={sectionPath} />
      <div className="ml-[54px]">
        <Topbar section={section} currentPage={pagePath} />
        <main id="main" tabIndex={-1} className="focus:outline-none">
          {children}
        </main>
      </div>
    </>
  );
};

export default AuthenticationCheck(Layout);
