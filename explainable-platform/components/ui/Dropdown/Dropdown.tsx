import { Dropdown as FBDropdown } from "flowbite-react";
export const Dropdown = (props: { data: string[] }) => {
  return (
    <FBDropdown label="Dropdown" inline>
      {props.data?.map((data, index) => {
        <FBDropdown.Item key={`${data}-${index}`}>{data}</FBDropdown.Item>;
      })}
    </FBDropdown>
  );
};
