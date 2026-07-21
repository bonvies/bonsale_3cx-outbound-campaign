import { IPmsExtensionService } from '../pmsExtensionService';
import * as freeSwitchPmsApi from '../freeSwitchPmsApi';

export const freeSwitchPmsExtension: IPmsExtensionService = {
  checkin: freeSwitchPmsApi.checkin,
  checkout: freeSwitchPmsApi.checkout,
  update: freeSwitchPmsApi.update,
};
