"use client";

import { FC } from "react";
import Link from "next/link";

// import { useUser } from "@/contexts/auth/user-context";
import { NavigatorProps } from "../Layout/Layout";
import { MinusCircleIcon } from "@heroicons/react/outline";
import { Logo } from "../Logo";

interface SidebarProps {
  currentPage: string;
  navigatorList: NavigatorProps[];
  asPath: string;
}

const Sidebar: FC<SidebarProps> = (props: SidebarProps) => {
  const { navigatorList, currentPage } = props;
  // const { signOut } = useUser();

  return (
    <div className="fixed z-40 flex flex-col items-center py-5 w-[54px] h-full min-h-screen border-solid border-r-[1px] border-[#E4E7EC] bg-white">
      <div>
        <Logo />
      </div>
      <div className="flex-1">
        <div className="pt-20 grid grid-row-5 gap-2 w-full justify-center">
          {navigatorList.map((item, index) => {
            return (
              <Link href={item.slug}>
                <div
                  className={`flex justify-center items-center relative h-10 w-10 rounded-md hover:bg-[#F8F8F8] hover:text-[#081226] text-[#898989] cursor-pointer ${
                    item.pathName === currentPage ? "bg-[#F8F8F8]" : ""
                  }`}
                  key={item.pathName}
                >
                  {item.pathName === currentPage && (
                    <div className="absolute h-full w-1 bg-token-purple rounded-navbar left-0" />
                  )}
                  <div
                    className={`${
                      item.pathName === currentPage ? "text-[#081226]" : ""
                    }`}
                  >
                    {item.icon}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
      <div className="flex w-full justify-center items-center relative h-10 w-10 rounded-md hover:bg-[#F8F8F8] hover:text-[#081226] text-[#898989] cursor-pointer">
        <MinusCircleIcon className="w-5" />
      </div>
    </div>
  );
};

export default Sidebar;
