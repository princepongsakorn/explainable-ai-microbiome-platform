import { Listbox, Transition } from '@headlessui/react';
import { ChevronUpIcon, ChevronRightIcon, ChevronLeftIcon } from '@heroicons/react/24/outline';
import { Fragment, useCallback, useEffect, useState } from 'react';
interface ClassNameProps {
  className?: string;
}

interface PaginationProps extends ClassNameProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  itemCount: number;
  onChange: (currentPage: number) => void;
}

export const Pagination = ({ currentPage, totalPages, totalItems, itemCount, itemsPerPage, className, onChange }: PaginationProps) => {
  const numberOfPage: any = Array.from({ length: totalPages }).map((_, index) => index + 1);
  const [selected, setSelected] = useState<number>(currentPage);

  useEffect(() => {
    setSelected(currentPage);
  }, [currentPage]);

  const numberOfDataPerPage = () => {
    const numeral = currentPage * itemsPerPage;
    const frontNumber = currentPage === 1 ? 1 : numeral - itemsPerPage + 1;
    const lastNumber = frontNumber + itemCount - 1;

    if (lastNumber === frontNumber) {
      return lastNumber;
    } else if (frontNumber > totalItems) {
      return 0;
    } else {
      return frontNumber + '-' + lastNumber;
    }
  };

  const handelOnChange = useCallback(
    (value: any) => {
      setSelected(value);
      onChange(value);
    },
    [currentPage],
  );

  const handleClickPrev = () => {
    let numberSelected = +selected;
    if (totalPages > 0 && numberSelected !== 1) {
      const page = numberSelected === 1 ? 1 : numberSelected - 1;
      handelOnChange(page);
    }
  };

  const handleClickNext = () => {
    let numberSelected = +selected;
    if (totalPages > 0 && totalPages !== numberSelected) {
      const page = +numberSelected === totalPages ? totalPages : numberSelected + 1;
      handelOnChange(page);
    }
  };

  const isFirstPage = () => {
    return currentPage === 1;
  };

  const isLastPage = () => {
    return currentPage === totalPages || totalPages === 0;
  };

  return (
    <div className={`flex w-full justify-between items-center ${className}`}>
      <div className="flex flex-row text-sm  text-grey-2">
        <div>{numberOfDataPerPage()}</div>
        <div className="ml-1">
          of <span>{totalItems}</span>
        </div>
      </div>
      <div className="flex flex-row justify-center items-center text-sm  text-grey-2">
        <div className="mr-2">The page you’re on</div>
        <div className="">
          <Listbox value={selected} onChange={handelOnChange}>
            {({ open }) => (
              <div className="relative ">
                <Listbox.Button className="relative w-full border-[1px] border-[#EEEEEE] h-6 px-2 rounded-lg">
                  <Listbox.Button className="relative w-full  pr-5 text-left bg-white border-opacity-25 rounded-lg cursor-pointer">
                    <span className="block truncat text-black font-normal text-xs">{currentPage}</span>
                    <span className="absolute inset-y-0 right-0 flex items-center pointer-events-none">
                      <ChevronUpIcon className={`${open ? 'transform rotate-180' : ''} w-3 h-3 text-black`} aria-hidden="true" />
                    </span>
                  </Listbox.Button>
                </Listbox.Button>
                <Transition as={Fragment} leave="transition ease-in duration-100" leaveFrom="opacity-100" leaveTo="opacity-0">
                  <Listbox.Options className="absolute flex flex-col bottom-7 items-center z-20 -translate-x-1 min-w-[50px] py-1 mt-1 overflow-y-auto text-base bg-white rounded-md shadow-option-dropdown max-h-60 ">
                    {numberOfPage.map(
                      (item: any, idx: number) =>
                        item !== selected && (
                          <Listbox.Option
                            key={idx}
                            className={() => `cursor-pointer select-none relative py-2 pl-4 pr-4 hover:text-black`}
                            value={item}
                          >
                            {({ selected }) => (
                              <span className={`${selected ? 'font-medium' : 'font-normal'} block truncate text-xs`}>{item}</span>
                            )}
                          </Listbox.Option>
                        ),
                    )}
                  </Listbox.Options>
                </Transition>
              </div>
            )}
          </Listbox>
        </div>
        <div className="flex bg-[#dfdfdf] w-[1px] h-6 mx-4" />
        <div className="flex">
          <button
            disabled={isFirstPage()}
            className={`text-base text-black mr-4 ${isFirstPage() ? 'opacity-20' : ''}`}
            onClick={() => handleClickPrev()}
          >
            <ChevronLeftIcon className='w-4'/>
          </button>
          <button
            disabled={isLastPage()}
            className={`text-base text-black ${isLastPage() ? 'opacity-20' : ''}`}
            onClick={() => handleClickNext()}
          >
            <ChevronRightIcon className='w-4'/>
          </button>
        </div>
      </div>
    </div>
  );
};
