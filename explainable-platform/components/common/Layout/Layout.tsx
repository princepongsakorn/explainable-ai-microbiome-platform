"use client";

import React, { FC, useEffect, useState } from "react";
import { useRouter } from "next/router";
import AuthenticationCheck from "@/hoc/AuthenticationCheck";
import Sidebar from "@/components/common/Sidebar";
import { ArrowUpTrayIcon, TableCellsIcon, CodeBracketIcon, BeakerIcon } from "@heroicons/react/24/outline";
import Topbar from "../Topbar";

interface Props {
  children: JSX.Element;
  pageProps: {
    mainPage: boolean;
    permission: string[];
  };
}

export interface NavigatorProps {
  icon?: object;
  pathName: string;
  name: string;
  slug: string;
  subMenu: SubNavigatorProps[];
}

export interface SubNavigatorProps {
  slug: string;
  pathName: string | string[];
  name: string;
}

const navigatorList: NavigatorProps[] = [
  {
    icon: <ArrowUpTrayIcon className="w-5" />,
    pathName: "predict",
    slug: "/predict",
    name: "predict",
    subMenu: [
      {
        slug: "/",
        pathName: "predict",
        name: "Upload file",
      },
    ],
  },
  {
    icon: <TableCellsIcon className="w-5" />,
    pathName: "prediction",
    slug: "/prediction",
    name: "Prediction List",
    subMenu: [
      {
        slug: "/",
        pathName: ["prediction", "local"],
        name: "Prediction List",
      },
    ],
  },
  {
    icon: <BeakerIcon className="w-5" />,
    pathName: "experiments",
    slug: "/experiments",
    name: "Experiments and Models",
    subMenu: [
      {
        slug: "/",
        pathName: "experiments",
        name: "Experiments",
      },
      {
        slug: "/models",
        pathName: "models",
        name: "Models",
      },
    ],
  },
  {
    icon: <CodeBracketIcon className="w-5" />,
    pathName: "develop",
    slug: "/develop",
    name: "Develop",
    subMenu: [
      {
        slug: "/",
        pathName: "develop",
        name: "Develop",
      },
    ],
  },
];

const Layout: FC<Props> = ({ children, pageProps }: Props) => {
  const router = useRouter();
  const [mainNavigate, SetMainNavigate] = useState<NavigatorProps[]>([]);
  const [subNavigator, setSubNavigator] = useState<NavigatorProps>();
  const splitPathUrl = router.pathname.split("/");
  
  useEffect(() => {
    SetMainNavigate(
      navigatorList
        .map((main) => {
          const subMenu = main.subMenu;
          return {
            ...main,
            subMenu,
            slug: `${main.slug}${subMenu[0]?.slug}`,
          };
        })
        .filter((main) => main.subMenu.length > 0)
    );
  }, []);

  useEffect(() => {
    const navigator = mainNavigate
      .filter((item: { pathName: string }) => item.pathName === splitPathUrl[1])
      .map((item: any) => {
        return { ...item, slug: item.slug.split("/").slice(0, -1).join("/") };
      });

    setSubNavigator(navigator[0]);

    if (pageProps.mainPage && navigator[0]) {
      router.push(`${navigator[0]?.slug}${navigator[0]?.subMenu[0].slug}`);
    }
  }, [router, mainNavigate]);

  return (
    <div>
      <Sidebar
        currentPage={splitPathUrl[1]}
        navigatorList={mainNavigate}
        asPath={router.asPath}
      />
      <Topbar navigatorList={subNavigator} currentSubMenu={splitPathUrl[1]} />
      <div className="ml-sidebar">
        <div className="ml-[54px]">{children}</div>
      </div>
    </div>
  );
};

export default AuthenticationCheck(Layout);
