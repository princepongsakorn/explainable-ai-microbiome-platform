import Swal from 'sweetalert2';

export const dialog = async (title: string, text: string, confirmButtonText: string = 'Close') => {
  return Swal.fire({
    title,
    text,
    confirmButtonText,
    buttonsStyling: false,
    customClass: {
      popup: 'container-custom',
      title: 'text-xl font-medium',
      htmlContainer: 'text-base font-normal',
      confirmButton:
        'text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm w-full sm:w-auto px-5 py-2.5 text-center',
    },
  }).then((result) => {
    return result.isConfirmed;
  });
};

export const dialogError = async (title: string, text: string, confirmButtonText: string = 'Close') => {
  return Swal.fire({
    title,
    text,
    confirmButtonText,
    buttonsStyling: false,
    customClass: {
      popup: 'container-custom',
      title: 'text-xl font-medium',
      htmlContainer: 'text-base font-normal',
      confirmButton:
        'text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm w-full sm:w-auto px-5 py-2.5 text-center',
    },
  }).then((result) => {
    return result.isConfirmed;
  });
};