import { ButtonHTMLAttributes } from "react";
import { ArrowPathIcon } from "@heroicons/react/24/outline";
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  className?: string;
  type?: "submit" | "reset" | "button";
  loading?: boolean;
}

export const MainButton = ({
  children,
  className,
  loading = false,
  ...props
}: ButtonProps) => {
  return (
    <button
      type="submit"
      disabled={loading}
      className={`text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 text-center ${
        loading ? "flex cursor-progress justify-center" : ""
      } ${className}`}
    >
      {loading ? <ArrowPathIcon className="animate-spin w-5" /> : children}
    </button>
  );
};

export const WhiteButton = ({
    children,
    className,
    loading = false,
    onClick,
    ...props
  }: ButtonProps) => {
    return (
      <button
        type="submit"
        disabled={loading}
        className={`py-2.5 px-5 text-sm font-medium text-gray-900 focus:outline-none bg-white rounded-lg border border-gray-200 hover:bg-gray-100 hover:text-blue-700 focus:z-10 focus:ring-4 focus:ring-gray-100 ${
          loading ? "flex cursor-progress justify-center" : ""
        } ${className}`}
        onClick={onClick}
      >
        {loading ? <ArrowPathIcon className="animate-spin w-5" /> : children}
      </button>
    );
  };
  