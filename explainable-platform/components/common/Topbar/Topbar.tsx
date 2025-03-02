import React, { FC, useEffect, useState } from "react";
import { throttle } from "lodash";
import cn from "classnames";
import Link from "next/link";

import { NavigatorProps } from "@/components/common/Layout/Layout";
import Image from "next/image";
import { getToken } from "@/pages/api/httpClient";
import { jwtDecode } from "jwt-decode";

interface TopbarProps {
  navigatorList?: NavigatorProps;
  currentSubMenu: string;
}

interface TopbarLinkProps {
  onClick: () => void;
  href: string;
  item: any;
  currentSubMenu: string;
  pathName: string[];
}

const TopbarLinkComponent = React.forwardRef((props: TopbarLinkProps, ref) => {
  const { onClick, href, item, currentSubMenu, pathName } = props;
  console.log(currentSubMenu, pathName, pathName.includes(currentSubMenu));
  return (
    <a onClick={onClick} href={href}>
      <div
        className={`flex items-center justify-center h-full relative px-1 hover:font-bold ${
          pathName.includes(currentSubMenu) ? "font-bold" : ""
        }`}
      >
        {item.name}
        {pathName.includes(currentSubMenu) && (
          <div className="w-full h-[2px] bg-black absolute bottom-0 rounded-topbar"></div>
        )}
      </div>
    </a>
  );
});

const Topbar: FC<TopbarProps> = (props: TopbarProps) => {
  const { navigatorList, currentSubMenu } = props;
  const [hasScrolled, setHasScrolled] = useState(false);
  const [profile, setProfile] = useState<any>();
  const firstLetter = profile ? profile?.username.charAt(0).toUpperCase() : "-";

  useEffect(() => {
    const profile = getProfile();
    setProfile(profile);
  }, []);

  function getProfile() {
    if (!!getToken()) {
      const profile: any = jwtDecode(getToken()!);
      return {
        username: profile?.username,
      };
    }
  }

  useEffect(() => {
    const handleScroll = throttle(() => {
      const offset = 0;
      const { scrollTop } = document.documentElement;
      const scrolled = scrollTop > offset;

      if (hasScrolled !== scrolled) {
        setHasScrolled(scrolled);
      }
    }, 200);

    document.addEventListener("scroll", handleScroll);
    return () => {
      document.removeEventListener("scroll", handleScroll);
    };
  }, [hasScrolled]);

  return (
    <div
      className={cn(
        `grid grid-cols-3 items-center h-[66px] sticky top-0 z-30 transition-all duration-150 border-solid border-b-[1px] border-[#E4E7EC] bg-[#F0F3F7]`,
        { "shadow-magical": hasScrolled }
      )}
    >
      <div className="col-start-2 flex w-full h-full justify-center">
        <div
          className={`flex flex-rows gap-6 justify-center text-sm justify-items-center h-full`}
        >
          {navigatorList?.subMenu?.map((item, index) => {
            const pathName = Array.isArray(item.pathName)
              ? item.pathName
              : [item.pathName];

            return (
              <Link
                key={index}
                href={{
                  pathname: `${navigatorList.slug}${item.slug}`,
                }}
                passHref
                legacyBehavior
              >
                <TopbarLinkComponent
                  item={item}
                  currentSubMenu={currentSubMenu}
                  pathName={pathName}
                  onClick={function (): void {
                    console.log(`${navigatorList.slug}${item.slug}`);
                  }}
                  href={""}
                />
              </Link>
            );
          })}
        </div>
      </div>
      <div className="flex justify-end mr-3 items-center gap-2">
        <div className="text-sm text-right text-[#747474]">{profile?.username}</div>
        <div className="w-[40px] h-[40px] overflow-hidden flex items-center justify-center rounded-full bg-blue-500 border-solid border-[1px] border-[#E4E7EC] shadow-sm">
          <div className="text-white rounded-full text-lg font-bold select-none">{firstLetter}</div>
        </div>
      </div>
    </div>
  );
};

export default Topbar;
