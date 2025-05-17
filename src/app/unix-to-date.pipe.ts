import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'unixToDate',
  standalone: true
})
export class UnixToDatePipe implements PipeTransform {
  transform(value: number | undefined | null, options?: Intl.DateTimeFormatOptions): string | null {
    if (value === undefined || value === null || isNaN(value)) {
      return null;
    }
    // Unix timestamp is in seconds, Date expects milliseconds
    const defaultOptions: Intl.DateTimeFormatOptions = {
      year: 'numeric', month: 'short', day: 'numeric'
    };
    const formattingOptions = { ...defaultOptions, ...options };
    return new Date(value * 1000).toLocaleDateString(undefined, formattingOptions);
  }
}
