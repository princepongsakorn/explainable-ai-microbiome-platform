import { useRouter } from "next/router";
import { jwtDecode } from "jwt-decode";
import Cookies from "js-cookie";
import { useEffect, useState } from "react";

interface Props {
  pageProps: {};
}

interface Token {
  exp: number;
}
const AuthenticationCheck = (WrappedComponent: any) => {
  return (props: any) => {
    const router = useRouter();
    const [isClient, setIsClient] = useState(false);

    useEffect(() => {
      setIsClient(true);
    }, []);

    if (!isClient) {
      return null;
    }

    const accessToken = Cookies.get("act");
    if (!accessToken) {
      router.push("/auth/login");
      return null;
    }

    const actDecode: { exp: number } = jwtDecode(accessToken);
    if (Date.now() >= actDecode.exp * 1000) {
      // router.push("/403");
      // return null;
    }

    return <WrappedComponent {...props} />;
  };
};

// const AuthenticationCheck = (WrappedComponent: any) => {
//   const isTokenExpired = (exp: number) => {
//     return Date.now() >= Number(exp) * 1000;
//   };
//   return (props: Props) => {
//     // checks whether we are on client / browser or server.
//     if (typeof window !== "undefined") {
//       const router = useRouter();
//       const accessToken = Cookies.get("act");
//       // if (!accessToken) {
//       //   router.push("/auth/login");
//       //   return null;
//       // }

//       // const actDecode: Token = jwtDecode(accessToken!);
//       // if (isTokenExpired(actDecode.exp)) {
//       //   router.push("/403");
//       //   return null;
//       // }

//       return <WrappedComponent {...props} />;
//     }

//     return <div></div>;
//   };
// };

export default AuthenticationCheck;
